import type { WhatsAppAiConfig } from "../whatsapp-ai-config";

/**
 * Niveles de gasto de la IA de WhatsApp (pedido de la dueña, 19-oct: «¿por qué
 * gastan tanto?», «niveles de gasto configurables»). Lo que más pesa en cada
 * respuesta son las reglas y las herramientas (fijas, ~7.000 tokens: Gemini
 * las cobra al 10 % cuando las tiene en caché); lo que cambia con el nivel es
 * cuánto del chat lee (mensajes, ejemplos de Dayana, mensajes viejos) y
 * cuántas vueltas puede dar con las herramientas (cada vuelta vuelve a mandar
 * todo).
 *
 * Con un tope diario, pasado el tope la IA sigue contestando en «Ahorro» el
 * resto del día (nunca se calla: regla de la dueña, nadie sin respuesta).
 *
 * Puro: los niveles y la cuenta en dólares.
 */

export type SpendLevel = "ahorro" | "equilibrado" | "completo" | "personalizado";

export type SpendLimits = {
  /** Últimos mensajes del chat que lee. */
  recentMessages: number;
  /** Respuestas parecidas de Dayana que le da de ejemplo. */
  examples: number;
  /** Mensajes viejos del mismo chat que tocan el tema. */
  snippets: number;
  /** Vueltas con herramientas como mucho (cada una vuelve a mandar todo). */
  maxSteps: number;
};

export const SPEND_LEVELS: Record<Exclude<SpendLevel, "personalizado">, SpendLimits> = {
  ahorro: { recentMessages: 25, examples: 3, snippets: 0, maxSteps: 4 },
  equilibrado: { recentMessages: 40, examples: 6, snippets: 3, maxSteps: 5 },
  // Lo de siempre (hasta el 19-oct era lo único).
  completo: { recentMessages: 60, examples: 10, snippets: 5, maxSteps: 6 },
};

export const SPEND_LEVEL_LABEL: Record<SpendLevel, string> = {
  ahorro: "Ahorro",
  equilibrado: "Equilibrado",
  completo: "Completo",
  personalizado: "Personalizado",
};

/** Lo que lee y cuántas vueltas da con ese nivel. «Personalizado» usa los números de Ajustes. */
export const spendLimits = (config: Pick<WhatsAppAiConfig, "spend" | "context" | "learning">, level: SpendLevel = config.spend.level): SpendLimits =>
  level === "personalizado"
    ? {
        recentMessages: config.context.recentMessages,
        examples: config.learning.examples,
        snippets: config.context.snippets,
        maxSteps: config.spend.maxSteps,
      }
    : SPEND_LEVELS[level];

/** Pasado el tope del día, la vuelta usa «Ahorro» (lo leen todos con `spendLimits`). */
export const applySpendLevel = (config: WhatsAppAiConfig, opts: { overBudget?: boolean } = {}): WhatsAppAiConfig =>
  opts.overBudget ? { ...config, spend: { ...config.spend, level: "ahorro" } } : config;

/**
 * Precio de lista de Gemini (US$ por millón de tokens; ai.google.dev/pricing,
 * 19-oct-2026). `gemini-3.5-flash-lite` es el de producción.
 */
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "gemini-3.5-flash-lite": { input: 0.3, cached: 0.03, output: 2.5 },
};
const DEFAULT_PRICE = PRICES["gemini-3.5-flash-lite"];

export type TokenTotals = { inputTokens: number; cachedTokens: number; outputTokens: number };

/** Cuánto costó, aproximado: lo que estaba en caché se cobra al 10 %. */
export const estimateUsd = (t: TokenTotals, model?: string | null): number => {
  const p = (model && PRICES[model]) || DEFAULT_PRICE;
  const cached = Math.min(t.cachedTokens, t.inputTokens);
  return ((t.inputTokens - cached) * p.input + cached * p.cached + t.outputTokens * p.output) / 1_000_000;
};

/** ¿Ya pasó el tope del día? Sin tope (0), nunca. */
export const isOverBudget = (spentTodayUsd: number, dailyBudgetUsd: number): boolean => dailyBudgetUsd > 0 && spentTodayUsd >= dailyBudgetUsd;
