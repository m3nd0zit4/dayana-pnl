import { prisma } from "@/lib/db";

/**
 * Lo que frenaron o corrigieron las protecciones de la IA (fase 5, 22-nov: «revisar a diario lo
 * que frenó la puerta y lo que corrigieron las protecciones»). Cada corrección del código queda
 * en `whatsapp_ai_runs.tool_calls` como una entrada con `auto: true` (el texto que no salió va en
 * `replaced`); los turnos que no se contestaron llevan su motivo en `reason`.
 *
 * Sirve para ver qué regla del prompt ignora el modelo (si una protección salta mucho, el
 * prompt o la herramienta tienen un problema) y para encontrar casos nuevos para el eval.
 * Lo que la puerta de envíos deja esperando va a los registros como «[puerta]».
 */

/** Las correcciones del código, con su nombre para Dayana. */
export const GUARD_LABELS: Record<string, string> = {
  loose_text: "Texto suelto fuera del formulario",
  payment_claim: "Daba un pago por confirmado",
  payment_data_promise: "Prometía datos de pago sin saber cuáles",
  dayana_claim: "Decía algo de Dayana sin respaldo",
  emergency_advice: "Líneas de emergencia",
  invented_link: "Enlace inventado",
  guest_reply: "Embudo a alguien inscrita en un evento",
  rude_reply: "Respuesta a un insulto",
  cheaper_reply: "Lo más económico (no le alcanza)",
  gemini_blocked: "Google bloqueó el pedido",
  no_reply: "No hacía falta contestar",
  send_payment_info: "Pegó los datos de pago que prometía",
  send_payment_link: "Pegó el enlace de Dayana",
  send_community_link: "Pegó el enlace de la comunidad",
  send_affordable_option: "Pegó la opción económica",
  send_urgent_session_link: "Pegó la sesión urgente",
  offer_free_call_slots: "Puso las horas de la agenda (el modelo no las buscó)",
};

type Trace = { tool?: unknown; input?: { auto?: unknown } | null; output?: { replaced?: unknown; note?: unknown } | null };

export type GuardReport = {
  since: string;
  runs: number;
  byStatus: Record<string, number>;
  /** Turnos sin respuesta, por motivo (los más frecuentes). */
  skipped: { reason: string; count: number }[];
  guards: { name: string; label: string; count: number; examples: { conversationId: string; at: string; replaced: string | null }[] }[];
};

/** Lo puro: agrupa las correcciones de un montón de turnos. */
export const summarizeGuards = (
  runs: { conversationId: string; queuedAt: Date; status: string; reason: string | null; toolCalls: unknown }[],
  since: Date
): GuardReport => {
  const byStatus: Record<string, number> = {};
  const skipped = new Map<string, number>();
  const guards = new Map<string, GuardReport["guards"][number]>();
  for (const r of runs) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.status === "SKIPPED" && r.reason) {
      const key = r.reason.split(":")[0].trim().slice(0, 60);
      skipped.set(key, (skipped.get(key) ?? 0) + 1);
    }
    for (const t of Array.isArray(r.toolCalls) ? (r.toolCalls as Trace[]) : []) {
      if (!t || typeof t.tool !== "string" || t.input?.auto !== true) continue;
      const g = guards.get(t.tool) ?? { name: t.tool, label: GUARD_LABELS[t.tool] ?? t.tool, count: 0, examples: [] };
      g.count++;
      if (g.examples.length < 3) {
        g.examples.push({
          conversationId: r.conversationId,
          at: r.queuedAt.toISOString(),
          replaced: typeof t.output?.replaced === "string" ? t.output.replaced.slice(0, 200) : null,
        });
      }
      guards.set(t.tool, g);
    }
  }
  return {
    since: since.toISOString(),
    runs: runs.length,
    byStatus,
    skipped: [...skipped].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 15),
    guards: [...guards.values()].sort((a, b) => b.count - a.count),
  };
};

/** El informe de los últimos `days` días (máximo 30). */
export const guardReport = async (days = 7): Promise<GuardReport> => {
  const since = new Date(Date.now() - Math.min(Math.max(days, 1), 30) * 86_400_000);
  const runs = await prisma.whatsAppAiRun.findMany({
    where: { queuedAt: { gte: since } },
    select: { conversationId: true, queuedAt: true, status: true, reason: true, toolCalls: true },
    orderBy: { queuedAt: "desc" },
    take: 5000,
  });
  return summarizeGuards(runs, since);
};
