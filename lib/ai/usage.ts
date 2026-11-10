import { OPERATIONAL_TZ, getDateKeyInTz } from "@/lib/datetime/zoned-time";

/**
 * Lo que gasta la IA, anotado en un solo sitio.
 *
 * Todas las llamadas a Gemini pasan por `geminiProvider()` (`./gemini.ts`):
 * las respuestas de WhatsApp, el asistente del panel, las fichas, las notas de
 * voz, la clasificación de chats, la revisión de fotos. Antes solo las
 * respuestas de WhatsApp dejaban sus tokens (`whatsapp_ai_runs`), así que la
 * cuenta de lo que cuesta la IA se quedaba corta. Aquí cada respuesta de
 * Google suma sus tokens a una fila por día y modelo (`ai_usage_daily`), que
 * es lo que lee la pantalla de Costos.
 *
 * Reglas:
 *
 * - **Nunca rompe ni retrasa una respuesta.** Se lee una copia del cuerpo y se
 *   escribe después; cualquier fallo se traga.
 * - Una fila por día (en la zona de Dayana) y modelo, sumada con un solo
 *   `INSERT … ON CONFLICT`: no hay una fila por llamada que limpiar después.
 * - Lo que se guarda son tokens, no dólares: el precio se aplica al leer
 *   (`lib/crm/costs/ai-prices.ts`), así un cambio de tarifa no obliga a
 *   reescribir la historia.
 */

export type AiUsage = {
  model: string;
  /** Tokens de entrada, incluidos los que estaban en caché y los de audio. */
  inputTokens: number;
  /** De la entrada, lo que Google ya tenía en caché (se cobra más barato). */
  cachedTokens: number;
  /** De la entrada, lo que era audio (notas de voz: se cobra más caro). */
  audioTokens: number;
  /** Lo que escribió, incluido lo que «pensó» (Google lo cobra como salida). */
  outputTokens: number;
};

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

/** `gemini-3.5-flash` a partir de `…/models/gemini-3.5-flash:generateContent`. */
export const modelFromUrl = (url: string): string | null => /\/models\/([^/:?]+):/.exec(url)?.[1] ?? null;

/**
 * Los tokens de un `usageMetadata` de Google, o null si no trae nada que
 * contar. Puro.
 */
export const usageFromMetadata = (model: string, metadata: unknown): AiUsage | null => {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const details = Array.isArray(m.promptTokensDetails) ? m.promptTokensDetails : [];
  const audioTokens = details.reduce<number>((sum, d) => {
    const detail = d as { modality?: unknown; tokenCount?: unknown } | null;
    return detail?.modality === "AUDIO" ? sum + count(detail.tokenCount) : sum;
  }, 0);
  const usage: AiUsage = {
    model,
    inputTokens: count(m.promptTokenCount),
    cachedTokens: count(m.cachedContentTokenCount),
    audioTokens,
    outputTokens: count(m.candidatesTokenCount) + count(m.thoughtsTokenCount),
  };
  return usage.inputTokens + usage.outputTokens > 0 ? usage : null;
};

/**
 * El uso de una respuesta en streaming (`streamGenerateContent`, SSE): cada
 * trozo es una línea `data: {…}` y el recuento definitivo viene en el último
 * que trae `usageMetadata`. También acepta el cuerpo JSON de una respuesta
 * normal. Puro.
 */
export const usageFromResponseText = (model: string, text: string): AiUsage | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      return usageFromMetadata(model, (JSON.parse(trimmed) as { usageMetadata?: unknown }).usageMetadata);
    } catch {
      return null;
    }
  }
  let last: AiUsage | null = null;
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:") || !line.includes("usageMetadata")) continue;
    try {
      const usage = usageFromMetadata(model, (JSON.parse(line.slice(5)) as { usageMetadata?: unknown }).usageMetadata);
      if (usage) last = usage;
    } catch {
      // Un trozo cortado no es el último: se ignora.
    }
  }
  return last;
};

/** Qué respuestas de Google traen tokens que contar. */
const COUNTED = /:(generateContent|streamGenerateContent|embedContent|batchEmbedContents)\b/;

/**
 * Mira una respuesta de Google y, si trae recuento de tokens, se lo pasa a
 * `onUsage`. Lee una COPIA del cuerpo, en segundo plano: quien pidió la
 * respuesta la recibe intacta y sin esperar. Nunca lanza.
 */
export const observeAiUsage = (url: string, res: Response, onUsage: (usage: AiUsage) => void): void => {
  try {
    if (!res.ok || !res.body || !COUNTED.test(url)) return;
    const model = modelFromUrl(url);
    if (!model) return;
    void res
      .clone()
      .text()
      .then((text) => {
        const usage = usageFromResponseText(model, text);
        if (usage) onUsage(usage);
      })
      .catch(() => undefined);
  } catch {
    // Una respuesta que no se puede copiar (cuerpo ya leído) se queda sin contar.
  }
};

/**
 * Suma el uso a la fila del día. Las importaciones son dinámicas a propósito:
 * `./gemini.ts` está en el grafo del agente del panel (eve), y un `import`
 * estático de `next/server` o de la base tumbaría ese arranque (ver
 * `lib/notifications/platform/emit.ts`).
 */
const writeAiUsage = async (usage: AiUsage, now: Date): Promise<void> => {
  const { prisma } = await import("@/lib/db");
  const day = getDateKeyInTz(now, OPERATIONAL_TZ);
  await prisma.$executeRaw`
    INSERT INTO "ai_usage_daily" ("day", "model", "calls", "input_tokens", "cached_tokens", "audio_tokens", "output_tokens", "updated_at")
    VALUES (${day}::date, ${usage.model}, 1, ${usage.inputTokens}, ${usage.cachedTokens}, ${usage.audioTokens}, ${usage.outputTokens}, NOW())
    ON CONFLICT ("day", "model") DO UPDATE SET
      "calls" = "ai_usage_daily"."calls" + 1,
      "input_tokens" = "ai_usage_daily"."input_tokens" + EXCLUDED."input_tokens",
      "cached_tokens" = "ai_usage_daily"."cached_tokens" + EXCLUDED."cached_tokens",
      "audio_tokens" = "ai_usage_daily"."audio_tokens" + EXCLUDED."audio_tokens",
      "output_tokens" = "ai_usage_daily"."output_tokens" + EXCLUDED."output_tokens",
      "updated_at" = NOW()
  `;
};

/** Para las pruebas y los scripts: escribe y espera. */
export const recordAiUsageNow = (usage: AiUsage, now: Date = new Date()): Promise<void> => writeAiUsage(usage, now);

/**
 * Anota el uso sin bloquear. Dentro de una petición usa `after()`, para que
 * Vercel no congele la invocación antes de que se escriba; fuera de una
 * petición (crons, el agente del panel) la invocación ya es larga y se espera.
 * Sin base de datos configurada (vista previa, pruebas) no hace nada.
 */
export const recordAiUsage = (usage: AiUsage): void => {
  if (!process.env.DATABASE_URL?.trim()) return;
  const task = () => writeAiUsage(usage, new Date()).catch(() => undefined);
  void (async () => {
    try {
      const { after } = await import("next/server");
      after(task);
    } catch {
      await task();
    }
  })();
};
