import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import type { DisplayBlock } from "@/agent/lib/display";
import { prisma } from "@/lib/db";

const ms = (a: Date | null, b: Date | null) => (a && b ? b.getTime() - a.getTime() : null);

export default defineTool({
  description:
    "List the WhatsApp AI's runs (one per reply attempt): status (REPLIED, AWAITING_APPROVAL = a proposal waiting for Dayana, APPROVED, ESCALATED, SKIPPED, ERROR…), reason, escalation category/severity, model, tokens and timing (waitMs in queue, durationMs thinking). Filter by chat or status; `counts` covers the whole window. Use it for «¿por qué no contestó la IA a X?» or «¿cuántos errores tuvo hoy?». For a quick health summary use whatsapp_ai_status.",
  inputSchema: z.object({
    conversationId: z.string().min(1).optional(),
    status: z
      .string()
      .regex(/^[A-Z_]{2,30}$/)
      .optional()
      .describe("QUEUED, THINKING, SENDING, REPLIED, DRAFTED, AWAITING_APPROVAL, APPROVED, SUPERSEDED, ESCALATED, SKIPPED, ERROR"),
    hours: z.number().int().min(1).max(720).optional().describe("Look-back window, default 24"),
    limit: z.number().int().min(1).max(100).optional().describe("Default 30"),
  }),
  async execute({ conversationId, status, hours = 24, limit = 30 }, ctx) {
    requireStaff(ctx);
    const since = new Date(Date.now() - hours * 3600_000);
    const base = { queuedAt: { gte: since }, ...(conversationId ? { conversationId } : {}) };
    const [rows, counts] = await Promise.all([
      prisma.whatsAppAiRun.findMany({
        where: { ...base, ...(status ? { status } : {}) },
        orderBy: { queuedAt: "desc" },
        take: limit,
        select: {
          id: true,
          conversationId: true,
          status: true,
          reason: true,
          category: true,
          severity: true,
          model: true,
          inputTokens: true,
          outputTokens: true,
          cachedTokens: true,
          queuedAt: true,
          startedAt: true,
          finishedAt: true,
          latencyMs: true,
          conversation: { select: { participantName: true, externalThreadId: true } },
        },
      }),
      prisma.whatsAppAiRun.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    ]);

    const runs = rows.map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason ? r.reason.slice(0, 300) : null,
      category: r.category,
      severity: r.severity,
      person: r.conversation.participantName ?? r.conversation.externalThreadId,
      model: r.model,
      tokens: r.inputTokens != null ? { input: r.inputTokens, output: r.outputTokens, cached: r.cachedTokens } : null,
      queuedAt: r.queuedAt.toISOString(),
      waitMs: ms(r.queuedAt, r.startedAt),
      durationMs: r.latencyMs ?? ms(r.startedAt, r.finishedAt),
      ref: {
        type: "conversation" as const,
        id: r.conversationId,
        href: `/admin/whatsapp?conversation=${r.conversationId}`,
      },
    }));

    const display: DisplayBlock[] = [];
    if (counts.length) {
      display.push({
        kind: "kpis",
        title: `IA de WhatsApp, últimas ${hours} h`,
        items: counts.map((c) => ({ label: c.status, value: String(c._count._all) })),
      });
    }
    if (runs.length) {
      display.push({
        kind: "table",
        title: "Ejecuciones",
        columns: ["Hora", "Persona", "Estado", "Motivo", "Duración"],
        rows: runs.map((r) => [
          r.queuedAt.slice(0, 16).replace("T", " "),
          r.person,
          r.status,
          r.reason?.slice(0, 60) ?? "",
          r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)} s` : "",
        ]),
      });
    }

    return {
      hours,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      runs,
      display,
    };
  },
});
