import { prisma } from "@/lib/db";
import { getDateKeyInTz, getStartOfDayInTz } from "@/lib/datetime/zoned-time";
import { getOperationalTimezone } from "../operational-timezone";
import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { applySpendLevel, estimateUsd, isOverBudget, type TokenTotals } from "./spend";

/**
 * El gasto de la IA con la base (reglas en `spend.ts`): lo que costaron las
 * respuestas de WhatsApp (`whatsapp_ai_runs`), aproximado con el precio de
 * lista. No cuenta las fichas, las notas de voz ni la clasificación de chats:
 * esas llamadas no quedan registradas.
 */

export type SpendWindow = TokenTotals & { runs: number; usd: number };

const totalsSince = async (since: Date): Promise<SpendWindow> => {
  const agg = await prisma.whatsAppAiRun.aggregate({
    where: { queuedAt: { gte: since }, model: { not: null } },
    _sum: { inputTokens: true, outputTokens: true, cachedTokens: true },
    _count: { _all: true },
  });
  const t: TokenTotals = {
    inputTokens: agg._sum.inputTokens ?? 0,
    cachedTokens: agg._sum.cachedTokens ?? 0,
    outputTokens: agg._sum.outputTokens ?? 0,
  };
  return { ...t, runs: agg._count._all, usd: estimateUsd(t) };
};

/** Hoy, los últimos 7 días y el mes (en la zona de Dayana). */
export const spendSummary = async (now = new Date()): Promise<{ today: SpendWindow; week: SpendWindow; month: SpendWindow }> => {
  const tz = await getOperationalTimezone();
  const [year, month] = getDateKeyInTz(now, tz).split("-").map(Number);
  const monthStart = getStartOfDayInTz(new Date(Date.UTC(year, month - 1, 1, 12)), tz);
  const [t, w, m] = await Promise.all([
    totalsSince(getStartOfDayInTz(now, tz)),
    totalsSince(new Date(now.getTime() - 7 * 24 * 3600_000)),
    totalsSince(monthStart),
  ]);
  return { today: t, week: w, month: m };
};

// Lo gastado hoy, guardado un minuto por instancia: no una consulta por respuesta.
let todayCache: { at: number; usd: number } | null = null;

const spentTodayUsd = async (now: Date): Promise<number> => {
  if (todayCache && now.getTime() - todayCache.at < 60_000) return todayCache.usd;
  const tz = await getOperationalTimezone();
  const usd = (await totalsSince(getStartOfDayInTz(now, tz))).usd;
  todayCache = { at: now.getTime(), usd };
  return usd;
};

/** La configuración con el nivel de gasto aplicado (y «Ahorro» si ya pasó el tope del día). */
export const configWithSpendLevel = async (config: WhatsAppAiConfig, now = new Date()): Promise<WhatsAppAiConfig> => {
  const budget = config.spend.dailyBudgetUsd;
  const overBudget = budget > 0 ? isOverBudget(await spentTodayUsd(now).catch(() => 0), budget) : false;
  return applySpendLevel(config, { overBudget });
};
