/**
 * Precio de lista de Gemini, en dólares por millón de tokens (nivel de pago,
 * estándar; aistudio.google.com/docs/pricing, leído el 9-nov-2026). Lo que
 * «piensa» el modelo se cobra como salida, y ya viene sumado ahí.
 *
 * `gemini-3.5-flash` —el modelo por defecto del asistente del panel— NO
 * aparece en la página de precios. Mientras no se sepa su tarifa se cuenta al
 * precio de `gemini-3.5-flash-lite` y la pantalla lo dice: es un piso, lo
 * real será igual o más. Cuando se sepa, se añade aquí una línea.
 *
 * (`lib/crm/whatsapp-agent/spend.ts` tiene su propia tabla para el tope
 * diario de WhatsApp: allí solo importa flash-lite.)
 */

export type AiPrice = { input: number; cached: number; audio: number; output: number };

export const AI_PRICES: Record<string, AiPrice> = {
  "gemini-3.5-flash-lite": { input: 0.3, cached: 0.03, audio: 0.3, output: 2.5 },
  "gemini-2.5-flash": { input: 0.3, cached: 0.03, audio: 1, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, cached: 0.01, audio: 0.3, output: 0.4 },
  "gemini-embedding-001": { input: 0.15, cached: 0.15, audio: 0.15, output: 0 },
};

const FALLBACK = AI_PRICES["gemini-3.5-flash-lite"];

export type AiTokens = { inputTokens: number; cachedTokens: number; audioTokens: number; outputTokens: number };

/** ¿Hay tarifa publicada para este modelo? */
export const hasAiPrice = (model: string): boolean => model in AI_PRICES;

/** Dólares de unos tokens. Sin tarifa conocida, al precio de flash-lite. */
export const aiCostUsd = (tokens: AiTokens, model: string): number => {
  const price = AI_PRICES[model] ?? FALLBACK;
  const cached = Math.min(tokens.cachedTokens, tokens.inputTokens);
  const audio = Math.min(tokens.audioTokens, tokens.inputTokens - cached);
  const text = tokens.inputTokens - cached - audio;
  return (text * price.input + cached * price.cached + audio * price.audio + tokens.outputTokens * price.output) / 1_000_000;
};
