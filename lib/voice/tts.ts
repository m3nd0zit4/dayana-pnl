import { createGeminiFetch, geminiKeys, type GeminiFetch } from "@/lib/ai/gemini";
import { pcmFromBytes, pcmRateFromMime } from "./opus-ogg";

/**
 * Texto → voz con Gemini TTS, para las notas de voz y las llamadas.
 *
 * Por qué Gemini y no Kokoro/Piper (abiertos y gratis): esos modelos hay que
 * alojarlos (Piper es un binario nativo; Kokoro, ~90 MB de ONNX más el
 * runtime), y en una función de Vercel eso son arranques en frío de varios
 * segundos o pasarse del tamaño máximo. Gemini TTS es una llamada HTTP con la
 * misma clave que ya paga el CRM (saldo prepago = nivel de pago: no entrena con
 * los datos), habla bien español y una nota de 20 s cuesta menos de medio
 * centavo de dólar. Usa la rotación de claves de `lib/ai/gemini.ts`.
 */

export const TTS_MODEL = () => process.env.GEMINI_TTS_MODEL?.trim() || "gemini-3.8-flash-tts";
export const TTS_VOICE = () => process.env.GEMINI_TTS_VOICE?.trim() || "Kore";

/*
 * Solo el texto, sin indicaciones de tono (probado el 8-nov): puestas delante
 * del texto el modelo las leía en voz alta como parte de la nota, y como
 * instrucción de sistema responde 400 «Developer instruction is not enabled for
 * this model». El idioma lo detecta solo.
 */

export class TtsError extends Error {}

type GeminiAudioResponse = {
  candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

let sharedFetch: GeminiFetch | null = null;

export const synthesizeSpeech = async (
  text: string,
  opts: { fetchImpl?: GeminiFetch; model?: string; voice?: string } = {}
): Promise<{ pcm: Int16Array; sampleRate: number }> => {
  const clean = text.trim();
  if (!clean) throw new TtsError("No hay texto para leer.");
  const doFetch = opts.fetchImpl ?? (sharedFetch ??= createGeminiFetch());
  const model = opts.model ?? TTS_MODEL();
  const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    // Con una sola clave la rotación no toca las cabeceras (el SDK pone la suya); aquí no hay SDK.
    headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKeys()[0] ?? "" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: clean }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice ?? TTS_VOICE() } } },
      },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as GeminiAudioResponse;
  if (!res.ok) throw new TtsError(`Gemini TTS respondió ${res.status}: ${json.error?.message ?? "sin detalle"}`);
  if (json.promptFeedback?.blockReason) throw new TtsError(`Gemini bloqueó el texto (${json.promptFeedback.blockReason}).`);
  const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new TtsError("Gemini TTS no devolvió audio.");
  const bytes = Uint8Array.from(Buffer.from(inline.data, "base64"));
  return { pcm: pcmFromBytes(bytes), sampleRate: pcmRateFromMime(inline.mimeType) };
};
