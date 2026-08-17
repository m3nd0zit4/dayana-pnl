import {
  NotificationCampaignStatus,
  NotificationDeliveryStatus,
  type Contact,
} from "@prisma/client";
import { renderQuickMessage } from "@/lib/crm/render-message";
import { prisma } from "@/lib/db";
import type { NotificationAudience, OutboundChannel } from "./config";
import { dispatchAndRecord } from "./dispatch";
import { fireNotification } from "./platform/emit";
import { contactVars, workshopVars } from "./variables";
import {
  decodeCursor,
  encodeCursor,
  keysetWhere,
  splitPage,
  type Page,
} from "@/lib/crm/pagination";

/**
 * 100, no 25. Con 25 una campaña de 100k son 4.000 pasos de Inngest; con 100
 * son 1.000. El techo lo pone la duración de un paso, que hace `batchSize`
 * `dispatchAndRecord` secuenciales — de ahí que sea 100 y no 500.
 */
export const BROADCAST_BATCH_SIZE = 100;
export const BROADCAST_SYNC_MAX_CONTACTS = 10;
/** Cinturón de seguridad: un bug de cursor no debe girar para siempre. */
export const BROADCAST_MAX_BATCHES = 5000;

export type CampaignContactRow = Pick<
  Contact,
  "id" | "firstName" | "lastName" | "displayName" | "phoneE164" | "email"
> & { createdAt: Date };

const audienceWhere = (audience: NotificationAudience) =>
  audience === "MARKETING_CONSENT"
    ? { consentMarketingAt: { not: null } }
    : {};

/** El tamaño de la audiencia sin materializarla. */
export const countCampaignAudience = (audience: NotificationAudience) =>
  prisma.contact.count({ where: audienceWhere(audience) });

/**
 * Una página keyset de la audiencia, ascendente por `(createdAt, id)`.
 *
 * Sustituye a `listCampaignAudience`, que hacía un `findMany` **sin `take`**:
 * la tabla de contactos entera. Y no una vez, sino una por lote — el bucle de
 * Inngest recargaba el contexto en cada paso y tiraba todo salvo 25 filas con
 * un `slice`. A 100.000 contactos eso eran 4.000 pasos × 100.000 filas: 400
 * millones de filas leídas por campaña, y un valor de retorno por paso que
 * revienta el límite de tamaño de Inngest.
 *
 * Ascendente y no descendente a propósito: los contactos nuevos entran por el
 * final, así que una alta a mitad de campaña no desplaza la ventana ni provoca
 * un reenvío. Entra en el siguiente lote, que es lo correcto.
 */
export const listCampaignAudiencePage = async (
  audience: NotificationAudience,
  opts: { cursor?: string | null; take?: number } = {}
): Promise<Page<CampaignContactRow>> => {
  const take = opts.take ?? BROADCAST_BATCH_SIZE;
  const cursor = decodeCursor(opts.cursor);
  const where = audienceWhere(audience);

  const rows = await prisma.contact.findMany({
    where: cursor
      ? { AND: [where, keysetWhere("createdAt", cursor, "asc")] }
      : where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: take + 1,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      email: true,
      phoneE164: true,
      createdAt: true,
    },
  });

  return splitPage(rows, take, (row) => encodeCursor(row.createdAt, row.id));
};

export type CreateBroadcastInput = {
  name: string;
  templateKey: string;
  channels: OutboundChannel[];
  audience: NotificationAudience;
  workshopEditionId?: string;
  createdByStaffId?: string;
};

export const createBroadcastCampaign = async (input: CreateBroadcastInput) => {
  const template = await prisma.messageTemplate.findUnique({
    where: { key_locale: { key: input.templateKey, locale: "es" } },
  });
  if (!template) {
    throw new Error(`Plantilla no encontrada: ${input.templateKey}`);
  }

  const edition = input.workshopEditionId
    ? await prisma.workshopEdition.findUnique({
        where: { id: input.workshopEditionId },
      })
    : null;

  // Un count, no la audiencia entera: lo único que hacía falta de aquellas
  // 100.000 filas era su longitud, y esto corre dentro de una petición HTTP.
  const contactCount = await countCampaignAudience(input.audience);

  const campaign = await prisma.notificationCampaign.create({
    data: {
      name: input.name,
      templateKey: input.templateKey,
      channels: input.channels,
      audience: input.audience,
      workshopEditionId: input.workshopEditionId ?? null,
      status: NotificationCampaignStatus.DRAFT,
      totalTargets: contactCount * input.channels.length,
      createdByStaffId: input.createdByStaffId ?? null,
    },
  });

  return { campaign, template, edition, contactCount };
};

export type CampaignRunContext = {
  campaignId: string;
  templateKey: string;
  templateBody: string;
  templateTitle: string;
  channels: OutboundChannel[];
  workshopEdition: Awaited<
    ReturnType<typeof prisma.workshopEdition.findUnique>
  >;
  audience: NotificationAudience;
  /** Dónde se quedó el envío. `null` = por el principio. */
  cursor: string | null;
};

export const loadCampaignRunContext = async (
  campaignId: string
): Promise<CampaignRunContext | null> => {
  const campaign = await prisma.notificationCampaign.findUnique({
    where: { id: campaignId },
    include: { workshopEdition: true },
  });
  if (!campaign) return null;

  const template = await prisma.messageTemplate.findUnique({
    where: { key_locale: { key: campaign.templateKey, locale: "es" } },
  });
  if (!template) throw new Error("Plantilla no encontrada");

  const channels = campaign.channels as OutboundChannel[];
  const audience = campaign.audience as NotificationAudience;

  return {
    campaignId,
    templateKey: campaign.templateKey,
    templateBody: template.body,
    templateTitle: template.title,
    channels,
    workshopEdition: campaign.workshopEdition,
    audience,
    cursor:
      campaign.cursorAt && campaign.cursorContactId
        ? encodeCursor(campaign.cursorAt, campaign.cursorContactId)
        : null,
  };
};

const recipientForChannel = (
  contact: CampaignContactRow,
  channel: OutboundChannel
): string | null => {
  if (channel === "EMAIL") return contact.email;
  if (channel === "SMS" || channel === "WHATSAPP_API") return contact.phoneE164;
  return null;
};

/**
 * Envía un lote y devuelve dónde continuar.
 *
 * Antes recibía un `offset` y hacía `ctx.contacts.slice(offset, …)` sobre la
 * audiencia entera ya materializada. Ahora se trae su propia página con el
 * cursor: el coste de un lote deja de depender del tamaño de la audiencia.
 */
export const processCampaignBatch = async (
  ctx: CampaignRunContext,
  cursor: string | null,
  batchSize: number
) => {
  const { items: slice, nextCursor } = await listCampaignAudiencePage(
    ctx.audience,
    { cursor, take: batchSize }
  );
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const contact of slice) {
    const vars = ctx.workshopEdition
      ? workshopVars(contact as Contact, ctx.workshopEdition)
      : contactVars(contact as Contact);
    const body = renderQuickMessage(ctx.templateBody, vars);

    for (const channel of ctx.channels) {
      const recipient = recipientForChannel(contact, channel);
      const { result } = await dispatchAndRecord({
        contactId: contact.id,
        channel,
        templateKey: ctx.templateKey,
        subject: ctx.templateTitle,
        body,
        campaignId: ctx.campaignId,
        vars,
        recipient: recipient ?? undefined,
      });

      if (result.status === NotificationDeliveryStatus.SENT) sent += 1;
      else if (result.status === NotificationDeliveryStatus.FAILED) failed += 1;
      else skipped += 1;
    }
  }

  // El avance del cursor va en el MISMO update que los contadores: si se
  // escribieran por separado, un fallo entre los dos dejaría la posición y los
  // contadores discrepando, y nadie sabría cuál creer.
  const last = slice.at(-1);
  if (slice.length > 0) {
    await prisma.notificationCampaign.update({
      where: { id: ctx.campaignId },
      data: {
        sentCount: { increment: sent },
        failedCount: { increment: failed },
        skippedCount: { increment: skipped },
        ...(last ? { cursorAt: last.createdAt, cursorContactId: last.id } : {}),
      },
    });
  }

  return { sent, failed, skipped, processed: slice.length, nextCursor };
};

export const startCampaignRun = async (campaignId: string) => {
  const ctx = await loadCampaignRunContext(campaignId);
  if (!ctx) throw new Error("Campaña no encontrada");

  const contactCount = await countCampaignAudience(ctx.audience);

  await prisma.notificationCampaign.update({
    where: { id: campaignId },
    data: {
      status: NotificationCampaignStatus.RUNNING,
      startedAt: new Date(),
      totalTargets: contactCount * ctx.channels.length,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      // Arrancar es empezar por el principio: los contadores se ponen a cero,
      // así que la posición tiene que acompañarlos o el reinicio saltaría a
      // todos los que ya se habían enviado en el intento anterior.
      cursorAt: null,
      cursorContactId: null,
    },
  });

  return { ...ctx, cursor: null, contactCount };
};

export const finalizeCampaignRun = async (campaignId: string) => {
  const campaign = await prisma.notificationCampaign.update({
    where: { id: campaignId },
    data: {
      status: NotificationCampaignStatus.COMPLETED,
      completedAt: new Date(),
    },
  });

  fireNotification({
    eventType: "CAMPAIGN_COMPLETED",
    title: `Campaña "${campaign.name}" finalizada`,
    body: `${campaign.sentCount} enviados · ${campaign.failedCount} fallidos · ${campaign.skippedCount} omitidos`,
    href: "/admin/messages",
    entityType: "NotificationCampaign",
    entityId: campaignId,
    metadata: {
      sent: campaign.sentCount,
      failed: campaign.failedCount,
      skipped: campaign.skippedCount,
    },
    staff: "ALL",
  });
};

export const runBroadcastCampaign = async (campaignId: string) => {
  const campaign = await prisma.notificationCampaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign) throw new Error("Campaña no encontrada");
  if (campaign.status === NotificationCampaignStatus.COMPLETED) {
    return { alreadyCompleted: true };
  }

  const ctx = await startCampaignRun(campaignId);
  let totals = { sent: 0, failed: 0, skipped: 0 };
  let cursor: string | null = null;
  let processed = 0;
  let batches = 0;

  do {
    const batch = await processCampaignBatch(ctx, cursor, BROADCAST_BATCH_SIZE);
    totals = {
      sent: totals.sent + batch.sent,
      failed: totals.failed + batch.failed,
      skipped: totals.skipped + batch.skipped,
    };
    processed += batch.processed;
    cursor = batch.nextCursor;
    batches += 1;
    if (batches > BROADCAST_MAX_BATCHES) throw new Error("demasiados lotes");
  } while (cursor);

  await finalizeCampaignRun(campaignId);
  return { ...totals, contacts: processed };
};
