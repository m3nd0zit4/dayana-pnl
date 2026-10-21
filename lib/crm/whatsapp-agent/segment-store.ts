import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { isWhatsAppUserId, whatsAppDigits, whatsAppIdVariants } from "@/lib/whatsapp-contact";
import { findClientEvidence } from "../client-evidence";
import { clearManualCategory, getTeamPhones, isClassifyEnabled, loadFactsBatch, setManualCategory } from "../chat-category";
import { isIgnoredNumber } from "../whatsapp-ignored-numbers";
import { contactForMarkedClient, ensureConversationContact } from "../whatsapp-client-contact";
import { appointmentsFor } from "./appointments";
import type { DossierFacts } from "./dossier";
import { isFreeCallAppointment, isFreeCallService } from "./event-title";
import { resolveSegment, type SegmentVerdict } from "./segment";
import { resolveStage, type Stage } from "./stage";
import { conversationSituation } from "./situation";
import { CHAT_LINK_MAX_AGE_DAYS, isPaymentInfo } from "./chat-payment-link";
import { isAutoSend } from "../whatsapp-attention-rules";

/**
 * Calcula el segmento de un chat con todo lo que se sabe (CRM, todo el chat,
 * la ficha, la agenda) y lo guarda en la ficha. Barato: unas pocas consultas
 * y expresiones regulares, sin modelo (la parte del modelo ya está en la
 * ficha). Lo usan el ejecutor de la IA antes de contestar, el reloj al poner
 * las fichas al día y las marcas de Dayana.
 */

const MAX_MESSAGES = 3000;
const MAX_EVIDENCE = 10;

/** Lo que se calcula de cada chat: el segmento (quién atiende) y el estado (en qué punto está). */
export type SegmentResult = SegmentVerdict & { stage: Stage };

/**
 * La última llamada gratis que ya pasó: `missed` si no contestó, `done` si se
 * hizo o si no se sabe (ya pasó y nadie dijo que no: Dayana sabe), `null` si
 * no hubo ninguna. Una sesión pagada no cuenta.
 */
const pastFreeCallOf = async (input: { contactId: string | null; phone: string; conversationId: string }) => {
  const or: Prisma.CalendarAppointmentWhereInput[] = [{ conversationId: input.conversationId }];
  if (input.contactId) or.push({ contactId: input.contactId });
  if (!isWhatsAppUserId(input.phone)) {
    const phones = [input.phone, whatsAppDigits(`+${input.phone}`)].flatMap(whatsAppIdVariants);
    if (phones.length) or.push({ phone: { in: [...new Set(phones)] } });
  }
  const past = await prisma.calendarAppointment.findMany({
    where: { OR: or, status: "active", endsAt: { lt: new Date() } },
    orderBy: { startsAt: "desc" },
    take: 5,
    select: { startsAt: true, endsAt: true, sessionsLabel: true, callOutcome: true },
  });
  // «Se reagendó»: cuenta la llamada nueva, no esta.
  const free = past.find((a) => a.callOutcome !== "not_free" && a.callOutcome !== "rescheduled" && isFreeCallAppointment(a));
  if (!free) return null;
  return free.callOutcome === "no_answer" ? ("missed" as const) : ("done" as const);
};

export const computeSegment = async (conversationId: string): Promise<SegmentResult | null> => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, channel: "WHATSAPP" },
    select: {
      id: true,
      externalThreadId: true,
      contactId: true,
      participantName: true,
      lastInboundAt: true,
      category: true,
      categorySource: true,
      categoryConfidence: true,
      categoryReview: true,
      dossier: { select: { facts: true } },
    },
  });
  if (!conversation) return null;

  const [teamPhones, classifyEnabled, ignoredNumber, messages] = await Promise.all([
    getTeamPhones().catch(() => [] as string[]),
    isClassifyEnabled().catch(() => false),
    isIgnoredNumber(conversation.externalThreadId),
    prisma.conversationMessage.findMany({
      where: { conversationId, kind: { not: "system" } },
      orderBy: { sentAt: "desc" },
      take: MAX_MESSAGES,
      select: { direction: true, body: true, sentAt: true, isAutoReply: true, source: true, clientKey: true, status: true },
    }),
  ]);
  const facts = (await loadFactsBatch([conversation], teamPhones)).get(conversation.id)?.signals ?? {};
  const chronological = [...messages].reverse();
  const evidence = findClientEvidence(chronological);
  const dossierFacts = (conversation.dossier?.facts ?? {}) as DossierFacts;

  const { next } = await appointmentsFor({ contactId: conversation.contactId, phone: conversation.externalThreadId }).catch(() => ({
    next: null,
  }));
  const [pastFreeCall, activeEnrollment] = await Promise.all([
    pastFreeCallOf({ contactId: conversation.contactId, phone: conversation.externalThreadId, conversationId }),
    conversation.contactId
      ? prisma.enrollment.findFirst({ where: { contactId: conversation.contactId, status: "ACTIVE" }, select: { id: true } })
      : Promise.resolve(null),
  ]);
  const upcomingBooking = await prisma.whatsAppBooking.findFirst({
    where: { conversationId, startsAt: { gte: new Date() }, status: { notIn: ["CANCELLED", "cancelled"] } },
    select: { service: true, startsAt: true, endsAt: true, createdAt: true },
  });
  const freeCallUpcoming =
    Boolean(next && isFreeCallAppointment(next)) ||
    Boolean(
      upcomingBooking &&
        isFreeCallService(upcomingBooking.service, (upcomingBooking.endsAt.getTime() - upcomingBooking.startsAt.getTime()) / 60_000)
    );

  // Lo último que Dayana escribió ella misma con cómo pagar (no la IA, ni lo
  // automático, ni una propuesta de la IA que ella aprobó).
  const payInfoSince = Date.now() - CHAT_LINK_MAX_AGE_DAYS * 24 * 3600_000;
  const dayanaPaymentInfoAt =
    messages.find(
      (m) =>
        m.direction === "OUTBOUND" &&
        !m.isAutoReply &&
        m.source !== "approval" &&
        !isAutoSend(m) &&
        m.status !== "FAILED" &&
        m.sentAt.getTime() >= payInfoSince &&
        isPaymentInfo(m.body)
    )?.sentAt ?? null;

  const situation = conversationSituation(
    chronological.map((m) => ({
      direction: m.direction === "INBOUND" ? ("INBOUND" as const) : ("OUTBOUND" as const),
      source: m.source,
      clientKey: m.clientKey,
      status: m.status,
    }))
  );

  const verdict = resolveSegment({
    isTeam: facts.isTeamPhone,
    ignoredNumber,
    category: conversation.category,
    categorySource: conversation.categorySource,
    categoryConfidence: conversation.categoryConfidence,
    categoryReview: conversation.categoryReview,
    classifyEnabled,
    crm: {
      hasApprovedPayment: facts.hasApprovedPayment,
      hasPaidEnrollment: facts.hasPaidEnrollment,
      hasTherapySession: facts.hasTherapySession,
      hasUnpaidActiveEnrollment: facts.hasUnpaidActiveEnrollment,
    },
    history: {
      dayanaConfirmed: evidence.filter((e) => e.strength === "strong" && e.who === "dayana").length,
      personClaims: evidence.filter((e) => e.strength === "strong" && e.who === "persona").length,
      dossierPaidSignals: dossierFacts.paidSignals?.length ?? 0,
      dossierHadSession: dossierFacts.hadCallOrSession,
      dayanaPaymentInfoAt,
    },
    freeCallUpcoming,
    freeCallBookedAt: upcomingBooking?.createdAt ?? (next && isFreeCallAppointment(next) ? next.createdAt : null),
    pastFreeCall,
    hadConversation: !situation.isNew,
  });
  const stage = resolveStage({
    verdict,
    // En proceso: matrícula activa o una sesión pagada próxima en el calendario.
    activeProcess: Boolean(activeEnrollment) || Boolean(next && !isFreeCallAppointment(next)),
    missedFreeCall: pastFreeCall === "missed",
  });

  const data = {
    segment: verdict.segment,
    segmentSource: verdict.source,
    segmentConfidence: verdict.confidence,
    segmentReason: verdict.reason,
    segmentReview: verdict.review,
    segmentAt: new Date(),
    stage,
    clientEvidence: evidence.length
      ? (evidence.slice(-MAX_EVIDENCE) as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull,
  };
  await prisma.whatsAppDossier.upsert({
    where: { conversationId },
    create: { conversationId, ...data },
    update: data,
  });
  // Clienta confirmada (pagó y Dayana lo confirmó) sin contacto: queda en el CRM.
  if (verdict.segment === "client" && !verdict.review && !conversation.contactId) {
    await ensureConversationContact({ conversationId, staffUserId: null, sourceDetail: "Clienta de WhatsApp" }).catch((e: unknown) =>
      console.warn("[clienta] no se pudo crear el contacto", conversationId, e instanceof Error ? e.message : e)
    );
  }
  return { ...verdict, stage };
};

/**
 * Chats cuyo estado hay que recalcular: sin estado, con mensajes nuevos desde
 * el último cálculo, o que tenían la llamada agendada y su hora ya pasó (pasan
 * a «tuvo la llamada» o «no contestó» sin que nadie escriba).
 */
const staleStageRows = (limit: number) => prisma.$queryRaw<{ id: string }[]>`
  SELECT c.id FROM conversations c
  LEFT JOIN whatsapp_dossiers d ON d.conversation_id = c.id
  WHERE c.channel = 'WHATSAPP'
    AND (
      d.conversation_id IS NULL OR d.segment IS NULL OR d.stage IS NULL OR d.segment_at IS NULL
      OR d.segment_at < c.last_message_at
      OR d.segment_at < d.updated_at - interval '1 second'
      OR (d.segment = 'free_call_booked' AND d.segment_at < now() - interval '30 minutes')
      OR EXISTS (
        SELECT 1 FROM calendar_appointments a
        WHERE a.conversation_id = c.id AND a.call_outcome_at > d.segment_at
      )
    )
  ORDER BY c.last_message_at DESC NULLS LAST
  LIMIT ${limit}`;

/** Recalcula estados hasta `budgetMs` (el reloj y el botón «Calcular estados»). */
export const refreshStages = async (budgetMs: number, opts: { limit?: number } = {}) => {
  const deadline = Date.now() + budgetMs;
  const rows = await staleStageRows(opts.limit ?? 400);
  let computed = 0;
  let failed = 0;
  for (const { id } of rows) {
    if (Date.now() > deadline) break;
    const ok = await computeSegment(id).then(
      () => true,
      (e: unknown) => {
        console.warn("[estado] no se pudo calcular", id, e);
        return false;
      }
    );
    if (ok) computed++;
    else failed++;
  }
  return { computed, failed, remaining: rows.length - computed - failed };
};

/**
 * Para quien no se pueda calcular (error de base): la IA contesta como a
 * alguien que ya conversó (sin ofrecerle la llamada como a una nueva) y Dayana
 * lo revisa. Antes se trataba como clienta y la persona se quedaba sin respuesta.
 */
export const segmentOrSafe = async (conversationId: string): Promise<SegmentResult> =>
  (await computeSegment(conversationId).catch((e: unknown) => {
    console.warn("[segmento] no se pudo calcular", conversationId, e);
    return null;
  })) ?? {
    segment: "returning_lead",
    confidence: 0,
    reason: "No se pudo calcular: se atiende como alguien que ya conversó, sin ofrecerle la llamada.",
    review: true,
    source: "rules",
    // «Por revisar»: la IA contesta pero no ofrece la llamada gratis (podría ser clienta).
    stage: "por_revisar",
  };

/** Los chats con una duda sobre si pagó (la IA sigue atendiendo): Dayana confirma o descarta. */
export const listSegmentReview = async (limit = 100) => {
  const rows = await prisma.whatsAppDossier.findMany({
    where: { segmentReview: true, conversation: { channel: "WHATSAPP" } },
    orderBy: { segmentAt: "desc" },
    take: limit,
    select: {
      conversationId: true,
      segment: true,
      segmentReason: true,
      clientEvidence: true,
      summary: true,
      conversation: { select: { participantName: true, externalThreadId: true, lastMessageAt: true, contact: { select: { firstName: true, lastName: true } } } },
    },
  });
  return rows.map((r) => ({
    conversationId: r.conversationId,
    name:
      [r.conversation.contact?.firstName, r.conversation.contact?.lastName].filter(Boolean).join(" ") ||
      r.conversation.participantName ||
      r.conversation.externalThreadId,
    reason: r.segmentReason,
    evidence: (r.clientEvidence ?? []) as { who: string; quote: string; at: string }[],
    summary: r.summary,
    lastMessageAt: r.conversation.lastMessageAt,
  }));
};

/**
 * La marca de Dayana: `true` = es clienta, `false` = no lo es (las frases
 * del chat ya no la vuelven clienta), `null` = quitar la marca. Usa la misma
 * categoría manual que el resto del CRM, así todo queda de acuerdo.
 */
export const markClient = async (conversationId: string, isClient: boolean | null, staffId: string | null) => {
  if (isClient === null) await clearManualCategory(conversationId, staffId);
  else await setManualCategory(conversationId, isClient ? "cliente" : "interesada", staffId);
  if (isClient) await contactForMarkedClient(conversationId, staffId);
  return computeSegment(conversationId);
};
