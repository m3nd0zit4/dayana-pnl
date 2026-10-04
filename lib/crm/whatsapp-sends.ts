import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { writeAuditLog } from "./audit";
import {
  planForRecipient,
  recipientFromContact,
  sendWhatsAppToRecipient,
  type RecipientInfo,
} from "./whatsapp-outbound";
import {
  HEADER_IMAGE_VAR,
  headerImageProblem,
  summarizePlans,
  type SendSummary,
} from "./whatsapp-outbound-plan";
import {
  approvedTemplateFor,
  remoteTemplateHeaderFormat,
  ensureTemplatesSubmitted,
  refreshTemplatesIfPending,
  getTemplatePrices,
  priceFor,
  type WaTemplate,
} from "./whatsapp-templates";

/**
 * Envíos masivos de WhatsApp desde el CRM: el enlace de un evento a todas las
 * inscritas, un recordatorio de taller, el seguimiento de los diagnósticos…
 *
 * Se preparan (quién, qué texto, qué plantilla) y se ejecutan por tandas que
 * pide la propia página, con barra de progreso: no hace falta ninguna cola ni
 * cron, y si se cierra la página se retoma donde quedó. Antes de enviar, la
 * vista previa dice cuántos van gratis (dentro de las 24 h), cuántos por
 * plantilla (y cuánto costaría) y cuántos no se pueden.
 */

export type SendKind = "evento" | "taller" | "diagnostico" | "pago" | "libre" | "comunidad";

export type SendPreview = SendSummary & {
  templateInfo: { key: string; title: string; category: string | null; status: string | null } | null;
  pricePerTemplate: number;
  currency: string;
  /** Hasta 8 personas de ejemplo por grupo, para que se vea a quién le llega. */
  sample: { name: string | null; action: string }[];
  /**
   * A quienes no se les puede escribir desde el CRM (más de 24 h y sin
   * plantilla aprobada): Dayana se lo manda desde su celular, gratis. En
   * diagnósticos lleva el mensaje que la IA escribió para esa persona.
   */
  phoneOnly: { contactId: string; name: string | null; phone: string; suggested: string | null }[];
  /**
   * Solo si se pidió (`checkHeader`): la cabecera de la plantilla aprobada en
   * 360dialog. `IMAGE` exige adjuntar la imagen; `UNKNOWN` = no se pudo mirar.
   */
  templateHeader?: string | null;
};

/** Errores de preparación de un envío que se le muestran tal cual a quien envía. */
export class WhatsAppSendSetupError extends Error {}

/** Envíos con imagen: el id del medio en WhatsApp dura 30 días. */
const HEADER_IMAGE_TTL_MS = 29 * 24 * 3600_000;

/**
 * La cabecera de la plantilla aprobada según 360dialog: `undefined` si no se
 * pudo comprobar (sin clave, 360dialog caído, no aparece).
 */
const approvedHeaderFormat = async (template: WaTemplate | null): Promise<string | null | undefined> => {
  if (!template?.metaTemplateName) return null;
  return remoteTemplateHeaderFormat(template.metaTemplateName, template.metaTemplateLang ?? "es").catch(
    (e: unknown) => {
      console.warn(`[whatsapp-sends] no se pudo leer la cabecera de ${template.metaTemplateName}: ${e instanceof Error ? e.message : e}`);
      return undefined;
    }
  );
};

const loadRecipients = async (contactIds: string[]): Promise<RecipientInfo[]> => {
  const unique = [...new Set(contactIds)].slice(0, 2000);
  const rows = await Promise.all(unique.map((id) => recipientFromContact(id)));
  return rows.filter((r): r is RecipientInfo => Boolean(r));
};

const phoneOnlyList = async (
  recipients: RecipientInfo[],
  withDiagnosticMessage: boolean
): Promise<SendPreview["phoneOnly"]> => {
  const people = recipients.filter((r): r is RecipientInfo & { contactId: string; phoneE164: string } =>
    Boolean(r.contactId && r.phoneE164)
  );
  const suggested = new Map<string, string>();
  if (withDiagnosticMessage && people.length) {
    const rows = await prisma.diagnostic.findMany({
      where: { contactId: { in: people.map((p) => p.contactId) }, completedAt: { not: null }, aiAnalysis: { not: Prisma.DbNull } },
      orderBy: { completedAt: "desc" },
      select: { contactId: true, aiAnalysis: true },
    });
    for (const r of rows) {
      const message = (r.aiAnalysis as { message?: string } | null)?.message;
      if (r.contactId && message && !suggested.has(r.contactId)) suggested.set(r.contactId, message);
    }
  }
  return people.map((p) => ({
    contactId: p.contactId,
    name: p.name,
    phone: p.phoneE164,
    suggested: suggested.get(p.contactId) ?? null,
  }));
};

export const previewSend = async (input: {
  contactIds: string[];
  templateKey?: string | null;
  kind?: SendKind;
  /** Preguntar a 360dialog si la plantilla lleva imagen (el diálogo masivo). */
  checkHeader?: boolean;
}): Promise<SendPreview> => {
  await refreshTemplatesIfPending().catch(() => undefined);
  const [recipients, template, prices] = await Promise.all([
    loadRecipients(input.contactIds),
    approvedTemplateFor(input.templateKey),
    getTemplatePrices(),
  ]);
  const header = input.checkHeader ? await approvedHeaderFormat(template) : null;
  const anyTemplate = input.templateKey
    ? await prisma.messageTemplate.findFirst({
        where: { key: input.templateKey },
        select: { key: true, title: true, metaCategory: true, metaApprovalStatus: true },
      })
    : null;
  const plans = await Promise.all(recipients.map((r) => planForRecipient(r, template)));
  if (!template && input.templateKey && plans.some((p) => p.action === "skip" && p.reason === "needs_template")) {
    await ensureTemplatesSubmitted([input.templateKey]).catch(() => undefined);
  }
  const price = priceFor(prices, template?.metaCategory ?? anyTemplate?.metaCategory);
  return {
    ...summarizePlans(plans, price),
    templateInfo: anyTemplate
      ? {
          key: anyTemplate.key,
          title: anyTemplate.title,
          category: anyTemplate.metaCategory,
          status: anyTemplate.metaApprovalStatus,
        }
      : null,
    pricePerTemplate: price,
    currency: prices.currency,
    phoneOnly: await phoneOnlyList(
      recipients.filter((_, i) => plans[i].action === "skip" && (plans[i] as { reason: string }).reason === "needs_template"),
      input.kind === "diagnostico"
    ),
    sample: recipients.slice(0, 8).map((r, i) => {
      const p = plans[i];
      return { name: r.name, action: p.action === "skip" ? p.reason : p.action };
    }),
    ...(input.checkHeader ? { templateHeader: header === undefined ? "UNKNOWN" : header } : {}),
  };
};

export const createSend = async (input: {
  title: string;
  kind: SendKind;
  text: string;
  templateKey?: string | null;
  vars?: Record<string, string>;
  contactIds: string[];
  staffId: string;
  /**
   * Id del medio de WhatsApp de la imagen (subida una vez,
   * `POST /api/admin/whatsapp/sends/image`). Va en `vars` y la reutilizan
   * todas: cabecera de la plantilla fuera de las 24 h, imagen con pie dentro.
   */
  headerImageId?: string | null;
}): Promise<{ id: string; total: number }> => {
  // Imagen y plantilla van juntas: se comprueba en 360dialog antes de empezar.
  const template = await approvedTemplateFor(input.templateKey);
  const problem = headerImageProblem({
    hasImage: Boolean(input.headerImageId),
    templateTitle: template?.title ?? null,
    headerFormat: await approvedHeaderFormat(template),
  });
  if (problem) throw new WhatsAppSendSetupError(problem);

  const vars: Record<string, string> = { ...(input.vars ?? {}) };
  delete vars[HEADER_IMAGE_VAR];
  if (input.headerImageId) vars[HEADER_IMAGE_VAR] = input.headerImageId;

  const recipients = await loadRecipients(input.contactIds);
  const send = await prisma.whatsAppSend.create({
    data: {
      title: input.title.slice(0, 200),
      kind: input.kind,
      text: input.text,
      templateKey: input.templateKey ?? null,
      vars: vars as Prisma.InputJsonValue,
      status: "SENDING",
      total: recipients.length,
      createdById: input.staffId,
      recipients: {
        create: recipients.map((r) => ({
          contactId: r.contactId,
          phone: r.phoneE164,
          name: r.name,
        })),
      },
    },
    select: { id: true, total: true },
  });
  await writeAuditLog({
    staffUserId: input.staffId,
    action: "WHATSAPP_BULK_CREATED",
    entityType: "WhatsAppSend",
    entityId: send.id,
    changes: {
      title: input.title,
      kind: input.kind,
      total: send.total,
      templateKey: input.templateKey,
      ...(input.headerImageId ? { headerImage: true } : {}),
    },
  }).catch(() => undefined);
  return send;
};

export type SendProgress = {
  id: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
};

const progressOf = async (id: string): Promise<SendProgress> => {
  const send = await prisma.whatsAppSend.findUniqueOrThrow({ where: { id } });
  const pending = await prisma.whatsAppSendRecipient.count({ where: { sendId: id, status: "PENDING" } });
  return {
    id,
    status: send.status,
    total: send.total,
    sent: send.sent,
    failed: send.failed,
    skipped: send.skipped,
    pending,
  };
};

/** Procesa la siguiente tanda. La página lo llama hasta que no queda nadie. */
export const processNextBatch = async (
  sendId: string,
  staffId: string,
  batchSize = 20
): Promise<SendProgress> => {
  const send = await prisma.whatsAppSend.findUnique({ where: { id: sendId } });
  if (!send) throw new Error("El envío no existe.");
  if (send.status === "CANCELLED" || send.status === "DONE") return progressOf(sendId);

  const template: WaTemplate | null = await approvedTemplateFor(send.templateKey);
  const { [HEADER_IMAGE_VAR]: headerImageId, ...vars } = (send.vars ?? {}) as Record<string, string>;
  // El id del medio caduca a los 30 días: retomar un envío viejo fallaría
  // persona por persona (y fuera de las 24 h, cobrando el intento). Se corta antes.
  if (headerImageId && Date.now() - send.createdAt.getTime() > HEADER_IMAGE_TTL_MS) {
    throw new WhatsAppSendSetupError(
      "La imagen de este envío ya caducó en WhatsApp (dura 30 días). Crea un envío nuevo con la imagen para las personas que faltan."
    );
  }
  const batch = await prisma.whatsAppSendRecipient.findMany({
    where: { sendId, status: "PENDING" },
    take: batchSize,
    orderBy: { id: "asc" },
  });

  for (const row of batch) {
    // Se marca antes de enviar: si la invocación se corta, no se repite.
    const claimed = await prisma.whatsAppSendRecipient.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "SENDING", processedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    const recipient = row.contactId ? await recipientFromContact(row.contactId) : null;
    const result = recipient
      ? await sendWhatsAppToRecipient({
          recipient,
          text: send.text,
          templateKey: send.templateKey,
          template,
          vars,
          headerImage: headerImageId ? { id: headerImageId } : null,
          source: `bulk:${sendId}`,
          staffId,
          // Si esta tanda se corta y se reintenta, a esta persona no le llega dos veces.
          clientKey: `bulk:${sendId}:${row.id}`,
        })
      : ({ status: "failed", error: "El contacto ya no existe." } as const);

    const status =
      result.status === "sent"
        ? "SENT"
        : result.status === "failed"
          ? "FAILED"
          : result.reason === "no_phone"
            ? "NO_PHONE"
            : result.reason === "opted_out"
              ? "OPTED_OUT"
              : "NEEDS_TEMPLATE";
    await prisma.whatsAppSendRecipient.update({
      where: { id: row.id },
      data: {
        status,
        mode: result.status === "sent" ? result.mode : null,
        conversationId: "conversationId" in result ? (result.conversationId ?? null) : null,
        messageId: result.status === "sent" ? result.messageId : null,
        error: result.status === "failed" ? result.error.slice(0, 500) : null,
        processedAt: new Date(),
      },
    });
    await prisma.whatsAppSend.update({
      where: { id: sendId },
      data:
        status === "SENT"
          ? { sent: { increment: 1 } }
          : status === "FAILED"
            ? { failed: { increment: 1 } }
            : { skipped: { increment: 1 } },
    });
    // WhatsApp limita la velocidad: un respiro entre mensajes.
    await new Promise((r) => setTimeout(r, 150));
  }

  const remaining = await prisma.whatsAppSendRecipient.count({
    where: { sendId, status: { in: ["PENDING", "SENDING"] } },
  });
  if (remaining === 0) {
    await prisma.whatsAppSend.update({
      where: { id: sendId },
      data: { status: "DONE", finishedAt: new Date() },
    });
  }
  return progressOf(sendId);
};

export const cancelSend = async (sendId: string) => {
  await prisma.whatsAppSend.update({ where: { id: sendId }, data: { status: "CANCELLED", finishedAt: new Date() } });
  await prisma.whatsAppSendRecipient.updateMany({
    where: { sendId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
};

export const listRecentSends = (take = 30) =>
  prisma.whatsAppSend.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      title: true,
      kind: true,
      status: true,
      total: true,
      sent: true,
      failed: true,
      skipped: true,
      createdAt: true,
      finishedAt: true,
    },
  });
