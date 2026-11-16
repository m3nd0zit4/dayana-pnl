import { generateText } from "ai";

import { geminiProvider, hasGeminiKey } from "@/lib/ai/gemini";

import {
  mediaVerdict,
  type MediaScreenRaw,
  type MediaVerdict,
  type TextVerdict,
} from "./sexual-content-rules";

/**
 * Revisión de lo que entra por WhatsApp ANTES de guardarlo (owner, 8-nov:
 * contenido sexual totalmente restringido; nunca se guarda en Blob ni se ve
 * en el CRM).
 *
 * Cada foto, sticker o video de una persona (no los de Dayana, no el historial)
 * va SOLO a Gemini con una pregunta neutra. Con la categoría sexual en
 * `BLOCK_NONE` Google devuelve sus puntajes en vez de bloquear; lo que bloquea
 * igual (`PROHIBITED_CONTENT`, `IMAGE_SAFETY`) es en sí la señal más fuerte.
 * La decisión está en `mediaVerdict` (pura). Un fallo (sin clave, demora,
 * archivo muy grande) da `unknown`: el mensaje se guarda como siempre.
 */

const SCREEN_TIMEOUT_MS = 20_000;
/** Gemini acepta ~20 MB por pedido y el base64 suma un tercio: los videos más grandes no se revisan. */
const MAX_SCREEN_BYTES = 14 * 1024 * 1024;

const SAFETY = [
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
] as const;

const screenModel = () =>
  geminiProvider()(process.env.GEMINI_SCREEN_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash");

const MEDIA_PROMPT = `Eres un filtro de moderación de una consulta de terapia. Mira SOLO este archivo (foto, sticker o video que alguien mandó por WhatsApp).
¿Muestra contenido sexual explícito: desnudez (genitales, pezones, nalgas descubiertas), actos sexuales, poses sexuales con ropa interior, o material pornográfico?
NO cuenta: una persona vestida, en traje de baño en la playa sin pose sexual, un bebé, una foto médica de una herida o de la piel, un dibujo anatómico, un comprobante de pago, un meme sin desnudez.
Responde SOLO con JSON: {"sexual": true|false, "nudity": true|false, "confidence": número de 0 a 1}`;

type GoogleMeta = {
  promptFeedback?: { blockReason?: string; safetyRatings?: MediaScreenRaw["ratings"] } | null;
  safetyRatings?: MediaScreenRaw["ratings"];
};

const parseJson = <T>(text: string): T | null => {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
};

export type ScreenDeps = {
  /** Para pruebas: lo que «devolvió Gemini», sin llamarlo. */
  run?: (bytes: Uint8Array, mimeType: string) => Promise<MediaScreenRaw>;
};

const runGeminiOnMedia = async (bytes: Uint8Array, mimeType: string): Promise<MediaScreenRaw> => {
  const res = await generateText({
    model: screenModel(),
    abortSignal: AbortSignal.timeout(SCREEN_TIMEOUT_MS),
    maxRetries: 1,
    providerOptions: { google: { safetySettings: [...SAFETY] } },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: MEDIA_PROMPT },
          { type: "file", data: bytes, mediaType: mimeType },
        ],
      },
    ],
  });
  const meta = (res.providerMetadata?.google ?? {}) as GoogleMeta;
  const raw = res.response?.body as { candidates?: { finishReason?: string }[] } | undefined;
  return {
    blockReason: meta.promptFeedback?.blockReason ?? null,
    finishReason: raw?.candidates?.[0]?.finishReason ?? (res.finishReason === "content-filter" ? "SAFETY" : null),
    ratings: [...(meta.safetyRatings ?? []), ...(meta.promptFeedback?.safetyRatings ?? [])],
    answer: res.text ? parseJson<MediaScreenRaw["answer"]>(res.text) : null,
  };
};

/** Revisa una foto, sticker o video. Nunca lanza. */
export const screenMedia = async (
  bytes: ArrayBuffer | Uint8Array,
  mimeType: string,
  deps: ScreenDeps = {}
): Promise<MediaVerdict> => {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.byteLength > MAX_SCREEN_BYTES) return { verdict: "unknown", reason: "too_big" };
  if (!deps.run && !hasGeminiKey()) return { verdict: "unknown", reason: "no_key" };
  const mime = mimeType.split(";")[0].trim() || "image/jpeg";
  try {
    return mediaVerdict(await (deps.run ?? runGeminiOnMedia)(data, mime));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("[contenido] no se pudo revisar un archivo", message.slice(0, 200));
    return mediaVerdict({ error: /abort|timeout/i.test(message) ? "timeout" : "failed" });
  }
};

const TEXT_PROMPT = `Eres el filtro de moderación del WhatsApp de una terapeuta (Dayana). Las personas le cuentan su vida: sexualidad, pareja, abuso que sufrieron, el cuerpo, la autoestima, problemas médicos. Eso NO es contenido sexual prohibido.
Prohibido es SOLO: proponerle sexo a quien recibe, pedirle fotos/videos íntimos o desnudos, describirle actos sexuales o genitales con intención sexual, ofrecer/vender contenido sexual o pornografía, acoso sexual.
Clasifica el ÚLTIMO mensaje (los anteriores son contexto).
Responde SOLO con JSON: {"explicit": true|false, "kind": "harassment"|"solicitation"|"proposition"|"explicit_description"|"sexual_offer"|"therapy"|"medical"|"victim"|"other"|"none", "confidence": número de 0 a 1}`;

/**
 * Para un texto que solo «suena» sexual (`sexualHint`): ¿es contenido sexual
 * prohibido o es terapia? Con los mensajes anteriores de contexto. Null si no
 * se pudo decidir (no bloquea).
 */
export const classifySexualText = async (
  latest: string,
  previous: string[] = [],
  deps: { run?: (prompt: string) => Promise<string> } = {}
): Promise<TextVerdict | null> =>
  // Una respuesta vacía o sin JSON pasa a veces (eval 8-nov: 1 de 54): un intento más.
  (await classifyOnce(latest, previous, deps)) ?? classifyOnce(latest, previous, deps);

const classifyOnce = async (
  latest: string,
  previous: string[],
  deps: { run?: (prompt: string) => Promise<string> }
): Promise<TextVerdict | null> => {
  if (!deps.run && !hasGeminiKey()) return null;
  const context = previous.slice(-4).map((t) => `- ${t.slice(0, 300)}`).join("\n");
  const prompt = `${TEXT_PROMPT}\n\nAnteriores:\n${context || "(ninguno)"}\n\nÚltimo mensaje:\n${latest.slice(0, 1200)}`;
  try {
    const text = deps.run
      ? await deps.run(prompt)
      : (
          await generateText({
            model: screenModel(),
            abortSignal: AbortSignal.timeout(SCREEN_TIMEOUT_MS),
            maxRetries: 1,
            providerOptions: { google: { safetySettings: [...SAFETY] } },
            prompt,
          })
        ).text;
    const v = parseJson<Partial<TextVerdict>>(text);
    if (!v || typeof v.explicit !== "boolean") return null;
    return { explicit: v.explicit, kind: String(v.kind ?? "other"), confidence: Number(v.confidence ?? 0) };
  } catch (e) {
    console.warn("[contenido] no se pudo revisar un texto", e instanceof Error ? e.message.slice(0, 200) : e);
    return null;
  }
};
