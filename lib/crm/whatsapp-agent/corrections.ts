import { prisma } from "@/lib/db";
import { proposePlaybookFromCorrection } from "./playbooks";

/**
 * Cuando Dayana corrige a la IA, se aprende (el bucle de aprendizaje de
 * Hermes Agent, con una persona decidiendo).
 *
 * Dos formas de corregir:
 * - edita un borrador de la IA antes de enviarlo (modo copiloto);
 * - escribe ella justo después de una respuesta automática (desde el CRM o
 *   desde el celular), en vez de dejarla pasar.
 *
 * Su respuesta ya entra como ejemplo de estilo por `learnFromLatestReply`.
 * Aquí se busca además una regla general, que queda como procedimiento
 * propuesto y apagado hasta que Dayana lo apruebe.
 */

/** Como mucho una propuesta por chat cada tanto: sin esto, un chat largo
 * corregido varias veces llenaría la lista de propuestas casi iguales. */
const COOLDOWN_MS = 6 * 3600_000;
const recent = new Map<string, number>();

export const learnFromCorrection = async (input: {
  conversationId: string;
  aiReply: string;
  dayanaReply: string;
}): Promise<void> => {
  const last = recent.get(input.conversationId) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return;
  recent.set(input.conversationId, Date.now());

  const client = await prisma.conversationMessage.findFirst({
    where: { conversationId: input.conversationId, direction: "INBOUND" },
    orderBy: { sentAt: "desc" },
    select: { body: true },
  });
  await proposePlaybookFromCorrection({
    clientText: client?.body?.trim() || "(sin texto)",
    aiReply: input.aiReply,
    dayanaReply: input.dayanaReply,
  });
};

/**
 * Dayana escribió en un chat (CRM o celular): si lo anterior fue una
 * respuesta automática de hace poco, es una corrección.
 */
export const learnIfCorrectingAutoReply = async (
  conversationId: string
): Promise<void> => {
  const [latest, previous] = await prisma.conversationMessage.findMany({
    where: { conversationId, direction: "OUTBOUND", status: { not: "FAILED" } },
    orderBy: { sentAt: "desc" },
    take: 2,
    select: { body: true, isAutoReply: true, sentAt: true },
  });
  if (!latest?.body || latest.isAutoReply || !previous?.isAutoReply || !previous.body) {
    return;
  }
  // Solo si corrigió pronto: al día siguiente ya es otra conversación.
  if (latest.sentAt.getTime() - previous.sentAt.getTime() > 2 * 3600_000) return;
  await learnFromCorrection({
    conversationId,
    aiReply: previous.body,
    dayanaReply: latest.body,
  });
};
