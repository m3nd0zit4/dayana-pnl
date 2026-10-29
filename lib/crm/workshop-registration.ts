import { randomUUID } from "node:crypto";
import { ContactSource, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { MetaWindowError, sendMetaMessage } from "@/lib/meta/send";
import { resolveWindow } from "@/lib/meta/window";
import { resolveWhatsAppThreadId } from "@/lib/meta/whatsapp-thread";
import { personFirstName } from "@/lib/person-name";
import { whatsAppDigits } from "@/lib/whatsapp-contact";
import { PROXIMO_WORKSHOP_SLUG } from "@/lib/workshops";

import { upsertContactByPhone } from "./contacts";
import { confirmationCapReason } from "./free-event-rules";
import { ensureContactTag } from "./tags";
import { getWhatsAppAiConfig } from "./whatsapp-ai-config";
import { isIgnoredNumber } from "./whatsapp-ignored-numbers";
import { ensureWhatsAppConversation } from "./whatsapp-outbound";
import { fillVars, templateParams } from "./whatsapp-outbound-plan";
import { approvedTemplateFor, ensureTemplatesSubmitted } from "./whatsapp-templates";
import { computeSegment } from "./whatsapp-agent/segment-store";
import { workshopOutreachSource, type OpenWorkshop } from "./whatsapp-agent/workshop-interest";
import { workshopPayUrl } from "./workshop-interests";
import { loadOutreachConversation, outreachAiOff, outreachRefusal } from "./workshop-outreach-guard";
import {
  isRegistrationOpen,
  PAGE_REGISTRATION_MESSAGE,
  pageVia,
  REGISTRATION_TEMPLATE_KEY,
  registrationClientKey,
  registrationSkip,
  registrationSourceDetail,
  WORKSHOP_INTEREST_TAG_LABEL,
  WORKSHOP_INTEREST_TAG_SLUG,
  WORKSHOP_REGISTRATION_CAP,
  workshopRegistrationTemplateVars,
  workshopRegistrationText,
  type RegistrationInput,
  type RegistrationState,
} from "./workshop-registration-rules";

/**
 * El registro de interés desde la página del taller (dueña, 28-oct: «la gente
 * que oprime ahí en taller se registra y se clasifica como interesada; una vez
 * clasificada, se le envía un mensaje automático, como se hacen los del
 * webinar, pero en este caso para que realice el pago del taller o agende una
 * llamada gratuita»). Reglas y textos en `workshop-registration-rules.ts`.
 *
 * 1. `registerWorkshopInterest`: el contacto (etiqueta `taller-interes`), su
 *    chat de WhatsApp (el que ya tiene ese número, o uno nuevo con
 *    `ensureWhatsAppConversation`, como los envíos) y su fila en «Interesadas».
 *    Quien ya pagó esta edición no se anota: la página le dice que ya tiene
 *    su cupo.
 * 2. `sendWorkshopRegistrationWhatsApp` (después de responder): el mensaje de
 *    la asistente. Texto dentro de las 24 h; fuera, la plantilla de Utilidad
 *    `taller_registro_pagina` en cuanto Meta la aprueba como Utilidad (se manda
 *    sola a aprobar); mientras tanto, o si Meta la pasa a Marketing, no sale y
 *    queda el motivo. Una vez por persona y
 *    edición (se reclama la fila antes de enviar), con tope por edición, y
 *    nunca a quien pidió la baja, un número personal o ignorado, una clienta
 *    o quien ya pagó. Sale con `source` `asistente:taller:<edición>`: su
 *    respuesta sigue el flujo del taller (el enlace o la llamada) por 3 días.
 */

// ── El taller ───────────────────────────────────────────────────────────────

export type RegistrationEdition = OpenWorkshop & {
  status: string;
  endedAt: Date | null;
  payUrl: string | null;
  /** `/pagar/p/<producto>`: el botón «Separar mi cupo» de la página (relativo, sirve en cualquier dominio). */
  payPath: string | null;
  open: boolean;
};

const EDITION_SELECT = {
  id: true,
  title: true,
  slug: true,
  status: true,
  endedAt: true,
  startsAt: true,
  startsAtHasTime: true,
  timezone: true,
  dateLabel: true,
  scheduleLabel: true,
  cardSummary: true,
  product: { select: { id: true, isActive: true, prices: { select: { id: true }, take: 1 } } },
} as const;

const toEdition = (e: Prisma.WorkshopEditionGetPayload<{ select: typeof EDITION_SELECT }>, now: Date): RegistrationEdition => {
  const { product, ...rest } = e;
  const payUrl = workshopPayUrl(product);
  return { ...rest, payUrl, payPath: payUrl && product ? `/pagar/p/${product.id}` : null, open: isRegistrationOpen(e, now) };
};

/** La edición por su dirección (nunca «próximo taller»), diga o no que está abierta. */
export const loadRegistrationEdition = async (slug: string, now = new Date()): Promise<RegistrationEdition | null> => {
  if (!slug || slug === PROXIMO_WORKSHOP_SLUG) return null;
  const e = await prisma.workshopEdition.findUnique({ where: { slug }, select: EDITION_SELECT });
  return e ? toEdition(e, now) : null;
};

const loadEditionById = async (id: string, now: Date): Promise<RegistrationEdition | null> => {
  const e = await prisma.workshopEdition.findUnique({ where: { id }, select: EDITION_SELECT });
  return e && e.slug !== PROXIMO_WORKSHOP_SLUG ? toEdition(e, now) : null;
};

/** La plantilla del registro tal como la dejó Meta (estado y categoría), o null si nunca se mandó. */
export const registrationTemplateState = async (): Promise<{ status: string | null; category: string | null } | null> => {
  const t = await prisma.messageTemplate.findFirst({
    where: { key: REGISTRATION_TEMPLATE_KEY, metaTemplateName: { not: null } },
    select: { metaApprovalStatus: true, metaCategory: true },
  });
  return t ? { status: t.metaApprovalStatus, category: t.metaCategory } : null;
};

// ── 1. El registro ──────────────────────────────────────────────────────────

/** El chat de WhatsApp que ya tiene ese número (en cualquiera de sus formas), sin crear ni tocar nada. */
const existingChatForPhone = async (phoneE164: string): Promise<{ id: string; contactId: string | null } | null> => {
  const waId = whatsAppDigits(phoneE164);
  const thread = await resolveWhatsAppThreadId(waId);
  return prisma.conversation.findFirst({
    where: { channel: "WHATSAPP", externalThreadId: { in: [...new Set([thread, waId, phoneE164.replace(/\D/g, "")])] } },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, contactId: true },
  });
};

const paidAny = async (contactIds: string[], editionId: string): Promise<boolean> =>
  contactIds.length > 0 &&
  (await prisma.enrollment.count({
    where: { contactId: { in: contactIds }, workshopEditionId: editionId, status: { in: ["ACTIVE", "COMPLETED"] } },
  })) > 0;

const appendNote = async (contactId: string, line: string): Promise<void> => {
  const current = await prisma.contact.findUnique({ where: { id: contactId }, select: { notes: true } });
  await prisma.contact.update({ where: { id: contactId }, data: { notes: current?.notes ? `${current.notes}\n${line}` : line } });
};

export type RegisterResult =
  | {
      status: "registered";
      contactId: string;
      conversationId: string;
      interestId: string;
      phoneE164: string;
      /** Ya se había registrado en la página para esta edición (no le sale otro WhatsApp). */
      alreadyRegistered: boolean;
      /** El nombre que escribió, si parece un nombre: el único que va en el WhatsApp. */
      firstName: string | null;
    }
  /** Ya pagó esta edición: no se anota ni se le escribe. */
  | { status: "enrolled"; contactId: string }
  /** Un número personal de Dayana: ni chat ni fila. */
  | { status: "personal"; contactId: string };

/** Lanza `INVALID_PHONE` (de `upsertContactByPhone`) si el número no sirve. */
export const registerWorkshopInterest = async (
  edition: Pick<RegistrationEdition, "id" | "title">,
  input: RegistrationInput,
  deps: { now?: Date } = {}
): Promise<RegisterResult> => {
  const now = deps.now ?? new Date();
  const { contact, phone } = await upsertContactByPhone({
    phone: input.phone,
    phoneCountry: input.phoneCountry ?? undefined,
    firstName: input.firstName,
    lastName: input.lastName ?? undefined,
    email: input.email ?? undefined,
    source: ContactSource.WEB_LEAD_FORM,
    sourceDetail: registrationSourceDetail(edition.title, input.ref),
    consentData: true,
    consentMarketing: input.consentMarketing,
  });
  // La etiqueta y la nota son para Dayana; si fallan, el registro sigue.
  await ensureContactTag(contact.id, WORKSHOP_INTEREST_TAG_SLUG, WORKSHOP_INTEREST_TAG_LABEL).catch((e: unknown) =>
    console.warn("[taller-registro] no se pudo poner la etiqueta", e)
  );
  const stamp = now.toLocaleDateString("es-CO", { dateStyle: "medium", timeZone: "America/Bogota" });
  await appendNote(contact.id, `[${stamp}] Se registró en la página del taller «${edition.title}».`).catch(() => undefined);

  const phoneE164 = phone.phoneE164;
  if (await isIgnoredNumber(whatsAppDigits(phoneE164))) return { status: "personal", contactId: contact.id };

  // Con correo, `upsertContactByPhone` puede devolver otro contacto que el dueño del número: se miran los dos.
  const [existing, owner] = await Promise.all([
    existingChatForPhone(phoneE164),
    prisma.contact.findUnique({ where: { phoneE164 }, select: { id: true } }),
  ]);
  const people = [...new Set([contact.id, owner?.id, existing?.contactId].filter((x): x is string => Boolean(x)))];
  if (await paidAny(people, edition.id)) return { status: "enrolled", contactId: contact.id };

  let conversationId: string;
  if (existing) {
    conversationId = existing.id;
    // Su chat sin contacto queda con este; uno que ya es de otro contacto no se toca.
    if (!existing.contactId) {
      await prisma.conversation.updateMany({ where: { id: existing.id, contactId: null }, data: { contactId: contact.id } });
    }
  } else {
    const name = [input.firstName, input.lastName].filter(Boolean).join(" ").trim() || null;
    conversationId = (await ensureWhatsAppConversation({ phoneE164, contactId: contact.id, name })).id;
  }

  // Una fila por chat y edición. Si ya estaba (preguntó por WhatsApp o se registró
  // antes), cuenta como otra vez (no un doble clic) y vuelve a «Nuevo» si estaba
  // en «No le interesa»: ahora sí le interesa.
  const [row] = await prisma.$queryRaw<{ id: string; offered_via: string | null; inserted: boolean }[]>`
    INSERT INTO workshop_interests (id, edition_id, conversation_id, first_message, first_asked_at, last_asked_at, asks, status, updated_at)
    VALUES (${randomUUID()}, ${edition.id}, ${conversationId}, ${PAGE_REGISTRATION_MESSAGE}, ${now}, ${now}, 1, 'nuevo', NOW())
    ON CONFLICT (edition_id, conversation_id) DO UPDATE
      SET asks = workshop_interests.asks + CASE WHEN workshop_interests.last_asked_at < EXCLUDED.last_asked_at - INTERVAL '10 minutes' THEN 1 ELSE 0 END,
          last_asked_at = GREATEST(workshop_interests.last_asked_at, EXCLUDED.last_asked_at),
          status = CASE WHEN workshop_interests.status = 'descartada' THEN 'nuevo' ELSE workshop_interests.status END,
          updated_at = NOW()
    RETURNING id, offered_via, (xmax = 0) AS inserted`;
  return {
    status: "registered",
    contactId: contact.id,
    conversationId,
    interestId: row.id,
    phoneE164,
    alreadyRegistered: !row.inserted && (row.offered_via ?? "").startsWith("pagina:"),
    firstName: personFirstName(input.firstName),
  };
};

// ── 2. El WhatsApp ──────────────────────────────────────────────────────────

export type RegistrationSendResult =
  | { status: "sent"; via: "text" | "template" }
  | { status: "skipped"; state: Exclude<RegistrationState, "text" | "template" | "enviando"> | "already" }
  | { status: "failed"; error: string };

type Deps = {
  send?: typeof sendMetaMessage;
  now?: Date;
  cap?: { perHour: number; perDay: number };
  /** Mandar la plantilla a aprobar (en las pruebas, nada: no se llama a 360dialog). */
  ensureTemplates?: (keys: string[]) => Promise<unknown>;
};

/** Los mensajes del registro que salieron (o se están enviando) en esta edición desde `since`. */
const sentSince = async (editionId: string, since: Date): Promise<number> => {
  const [r] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM workshop_interests
    WHERE edition_id = ${editionId}
      AND offered_via IN (${pageVia("text")}, ${pageVia("template")}, ${pageVia("enviando")})
      AND COALESCE(offered_at, updated_at) >= ${since}`;
  return r?.n ?? 0;
};

const isRealPhone = (thread: string) => /^\d{8,15}$/.test(thread);

export const sendWorkshopRegistrationWhatsApp = async (
  input: { editionId: string; interestId: string; contactId: string; firstName: string | null },
  deps: Deps = {}
): Promise<RegistrationSendResult> => {
  const now = deps.now ?? new Date();
  const send = deps.send ?? sendMetaMessage;
  const [row] = await prisma.$queryRaw<{ id: string; conversation_id: string }[]>`
    SELECT id, conversation_id FROM workshop_interests WHERE id = ${input.interestId} AND edition_id = ${input.editionId}`;
  if (!row) return { status: "failed", error: "La fila de interesadas no existe." };
  const edition = await loadEditionById(input.editionId, now);

  // Tope: freno de gasto, no una cuenta exacta (dos a la vez pueden pasarlo por una).
  const cap = deps.cap ?? WORKSHOP_REGISTRATION_CAP;
  const [lastHour, lastDay] = await Promise.all([
    sentSince(input.editionId, new Date(now.getTime() - 3600_000)),
    sentSince(input.editionId, new Date(now.getTime() - 24 * 3600_000)),
  ]);
  const capped = confirmationCapReason({ lastHour, lastDay }, cap);
  const first: RegistrationState = !edition?.open ? "cerrado" : capped ? "tope" : "enviando";

  // Reclamo: una vez por persona y edición. Quien ya tiene su registro de la
  // página (enviado, esperando la plantilla o con su motivo) no recibe otro.
  const claimed = await prisma.$executeRaw`
    UPDATE workshop_interests SET offered_via = ${pageVia(first)}, updated_at = NOW()
    WHERE id = ${row.id} AND (offered_via IS NULL OR offered_via NOT LIKE 'pagina:%')`;
  if (claimed === 0) return { status: "skipped", state: "already" };
  if (first !== "enviando" || !edition) return { status: "skipped", state: first === "tope" ? "tope" : "cerrado" };

  const finish = (state: RegistrationState) =>
    prisma.$executeRaw`UPDATE workshop_interests SET offered_via = ${pageVia(state)}, updated_at = NOW() WHERE id = ${row.id}`.catch(
      (e: unknown) => console.warn("[taller-registro] no se anotó el estado", state, e)
    );

  try {
    const conv = await loadOutreachConversation(row.conversation_id);
    if (!conv || conv.channel !== "WHATSAPP") {
      await finish("fallo");
      return { status: "failed", error: "No se encontró su chat de WhatsApp." };
    }
    const contactIds = [...new Set([input.contactId, conv.contactId].filter((x): x is string => Boolean(x)))];
    const [contacts, ignoredNumber, seg, config, contactedToday] = await Promise.all([
      prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { notifyWhatsapp: true } }),
      isIgnoredNumber(conv.externalThreadId),
      computeSegment(conv.id).catch(() => null),
      getWhatsAppAiConfig(),
      prisma.conversationMessage.count({
        where: {
          conversationId: conv.id,
          direction: "OUTBOUND",
          source: workshopOutreachSource(edition),
          status: { not: "FAILED" },
          sentAt: { gte: new Date(now.getTime() - 24 * 3600_000) },
        },
      }),
    ]);
    const [refusal, aiOff, paid] = await Promise.all([
      seg ? outreachRefusal(conv, { editionId: edition.id, config, now, seg, pastClientsOk: false }) : Promise.resolve(null),
      outreachAiOff(config),
      paidAny(contactIds, edition.id),
    ]);
    const skip =
      registrationSkip({
        optedOut: contacts.some((c) => c.notifyWhatsapp === false),
        phoneOk: isRealPhone(conv.externalThreadId),
        paid: paid || refusal?.reason === "paid",
        ignoredNumber,
        segment: seg?.segment ?? null,
        stage: seg?.stage ?? null,
        segmentReview: seg?.review ?? false,
        category: conv.category,
        categorySource: conv.categorySource,
        aiOff: Boolean(aiOff),
        aiBlocked: refusal?.reason === "assigned" || refusal?.reason === "blocked",
        hasUpcomingCall: refusal?.reason === "has_call",
        contactedToday: contactedToday > 0,
      }) ??
      // Sin su estado al día no se sabe si es clienta, por revisar o personal; y lo
      // que el guardián dice sin decir qué («por revisar, clienta o personal»): no sale.
      (!seg || refusal ? "revisar" : null);
    if (skip) {
      await finish(skip);
      return { status: "skipped", state: skip };
    }

    const source = workshopOutreachSource(edition);
    const clientKey = registrationClientKey(edition.id, conv.id);
    let via: "text" | "template";
    if (resolveWindow("WHATSAPP", conv.lastInboundAt, now).isOpen) {
      await send({
        conversationId: conv.id,
        body: workshopRegistrationText(edition, { firstName: input.firstName }),
        source,
        isAutoReply: true,
        clientKey,
      });
      via = "text";
    } else {
      // La plantilla habla del enlace de pago: sin precio no hay plantilla que sirva.
      if (!edition.payUrl) {
        await finish("sin_precio");
        return { status: "skipped", state: "sin_precio" };
      }
      const template = await approvedTemplateFor(REGISTRATION_TEMPLATE_KEY);
      if (!template?.metaTemplateName) {
        await finish("plantilla");
        // Nunca se mandó a aprobar (o Meta la rechazó): se manda sola, como mucho cada 30 min.
        await (deps.ensureTemplates ?? ensureTemplatesSubmitted)([REGISTRATION_TEMPLATE_KEY]).catch(() => undefined);
        return { status: "skipped", state: "plantilla" };
      }
      // Se pidió de Utilidad (dueña, 28-oct: «que no sea de marketing ya que la
      // persona aceptó»); si Meta la aprobó como Marketing, no sale sola como
      // marketing: queda dicho en «Interesadas» y Dayana decide.
      if ((template.metaCategory ?? "").toUpperCase() !== "UTILITY") {
        await finish("marketing");
        return { status: "skipped", state: "marketing" };
      }
      const vars = workshopRegistrationTemplateVars(edition, { firstName: input.firstName });
      await send({
        conversationId: conv.id,
        body: fillVars(template.body, vars),
        template: {
          name: template.metaTemplateName,
          language: template.metaTemplateLang ?? "es",
          variables: templateParams(template.metaVarNames, vars),
        },
        source,
        isAutoReply: true,
        clientKey,
      });
      via = "template";
    }
    // Ya salió: si no se anota, queda en el chat igual (y la fila lo lee por su clave).
    await prisma.$executeRaw`
      UPDATE workshop_interests
      SET offered_at = ${now}, offered_via = ${pageVia(via)},
          status = CASE WHEN status = 'nuevo' THEN 'contactada' ELSE status END,
          updated_at = NOW()
      WHERE id = ${row.id}`.catch((e: unknown) => console.warn("[taller-registro] no se anotó el envío", e));
    return { status: "sent", via };
  } catch (e) {
    // La ventana se cerró entre medias: es lo mismo que necesitar la plantilla.
    if (e instanceof MetaWindowError) {
      await finish("plantilla");
      return { status: "skipped", state: "plantilla" };
    }
    await finish("fallo");
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
};
