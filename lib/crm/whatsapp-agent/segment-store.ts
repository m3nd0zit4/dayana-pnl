import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { findClientEvidence } from "../client-evidence";
import { clearManualCategory, getTeamPhones, isClassifyEnabled, loadFactsBatch, setManualCategory } from "../chat-category";
import { isIgnoredNumber } from "../whatsapp-ignored-numbers";
import { appointmentsFor } from "./appointments";
import type { DossierFacts } from "./dossier";
import { isFreeCallAppointment, isFreeCallService } from "./event-title";
import { resolveSegment, type SegmentVerdict } from "./segment";
import { conversationSituation } from "./situation";

/**
 * Calcula el segmento de un chat con todo lo que se sabe (CRM, todo el chat,
 * la ficha, la agenda) y lo guarda en la ficha. Barato: unas pocas consultas
 * y expresiones regulares, sin modelo (la parte del modelo ya está en la
 * ficha). Lo usan el ejecutor de la IA antes de contestar, el reloj al poner
 * las fichas al día y las marcas de Dayana.
 */

const MAX_MESSAGES = 3000;
const MAX_EVIDENCE = 10;

export const computeSegment = async (conversationId: string): Promise<SegmentVerdict | null> => {
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
  const upcomingBooking = await prisma.whatsAppBooking.findFirst({
    where: { conversationId, startsAt: { gte: new Date() }, status: { notIn: ["CANCELLED", "cancelled"] } },
    select: { service: true, startsAt: true, endsAt: true },
  });
  const freeCallUpcoming =
    Boolean(next && isFreeCallAppointment(next)) ||
    Boolean(
      upcomingBooking &&
        isFreeCallService(upcomingBooking.service, (upcomingBooking.endsAt.getTime() - upcomingBooking.startsAt.getTime()) / 60_000)
    );

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
      strongEvidence: evidence.filter((e) => e.strength === "strong").length,
      dossierPaidSignals: dossierFacts.paidSignals?.length ?? 0,
      dossierHadSession: dossierFacts.hadCallOrSession,
    },
    freeCallUpcoming,
    hadConversation: !situation.isNew,
  });

  const data = {
    segment: verdict.segment,
    segmentSource: verdict.source,
    segmentConfidence: verdict.confidence,
    segmentReason: verdict.reason,
    segmentReview: verdict.review,
    segmentAt: new Date(),
    clientEvidence: evidence.length
      ? (evidence.slice(-MAX_EVIDENCE) as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull,
  };
  await prisma.whatsAppDossier.upsert({
    where: { conversationId },
    create: { conversationId, ...data },
    update: data,
  });
  return verdict;
};

/** Para quien no se pueda calcular (error de base), lo seguro: tratarla como clienta. */
export const segmentOrSafe = async (conversationId: string): Promise<SegmentVerdict> =>
  (await computeSegment(conversationId).catch((e: unknown) => {
    console.warn("[segmento] no se pudo calcular", conversationId, e);
    return null;
  })) ?? { segment: "client", confidence: 0, reason: "No se pudo calcular: se trata como clienta.", review: true, source: "rules" };

/** Los chats que la IA trata como clientas por duda: Dayana confirma o descarta. */
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
  return computeSegment(conversationId);
};
