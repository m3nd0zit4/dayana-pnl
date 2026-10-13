import { prisma } from "@/lib/db";

/**
 * ¿Está funcionando el flujo de primera vez? Lo de los últimos días, para el
 * tablero de Estado: cuántas personas nuevas, cuántas llamadas gratis se
 * agendaron, cuánto corrige Dayana lo que propone la IA, cuántos avisos de la
 * sala de espera y lo que tarda en contestar.
 */
export type SalesMetrics = {
  days: number;
  newLeads: number;
  freeCallsBooked: number;
  approvedAsIs: number;
  approvedEdited: number;
  waitingNotices: number;
  medianReplyMs: number | null;
  /** Llamadas gratis que ya pasaron: contestaron / no contestaron. */
  callsAnswered: number;
  callsMissed: number;
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/** `freeCallService`: el nombre del servicio de la llamada gratis (las demás citas no cuentan). */
export const salesMetrics = async (days: number, freeCallService: string): Promise<SalesMetrics> => {
  const since = new Date(Date.now() - days * 24 * 3600_000);
  const [newLeadRuns, freeCallsBooked, approved, waitingNotices, replies, outcomes] = await Promise.all([
    prisma.whatsAppAiRun.findMany({
      where: { queuedAt: { gte: since }, context: { path: ["situation"], equals: "new" } },
      distinct: ["conversationId"],
      select: { conversationId: true },
    }),
    prisma.whatsAppBooking.count({ where: { createdAt: { gte: since }, service: freeCallService } }),
    prisma.whatsAppAiRun.groupBy({
      by: ["reason"],
      where: { queuedAt: { gte: since }, status: "APPROVED" },
      _count: { _all: true },
    }),
    prisma.whatsAppAiRun.count({ where: { queuedAt: { gte: since }, reason: { startsWith: "waiting_room" } } }),
    prisma.whatsAppAiRun.findMany({
      where: { queuedAt: { gte: since }, status: "REPLIED", latencyMs: { gt: 0 } },
      orderBy: { queuedAt: "desc" },
      take: 500,
      select: { latencyMs: true },
    }),
    prisma.calendarAppointment.groupBy({
      by: ["callOutcome"],
      where: { callOutcomeAt: { gte: since }, callOutcome: { in: ["answered", "no_answer"] } },
      _count: { _all: true },
    }),
  ]);
  const outcome = (o: string) => outcomes.find((x) => x.callOutcome === o)?._count._all ?? 0;
  const byReason = (re: RegExp) => approved.filter((a) => re.test(a.reason ?? "")).reduce((n, a) => n + a._count._all, 0);
  return {
    days,
    newLeads: newLeadRuns.length,
    freeCallsBooked,
    approvedAsIs: byReason(/tal cual/i),
    approvedEdited: byReason(/con cambios/i),
    waitingNotices,
    medianReplyMs: median(replies.map((r) => r.latencyMs ?? 0).filter((n) => n > 0)),
    callsAnswered: outcome("answered"),
    callsMissed: outcome("no_answer"),
  };
};
