/**
 * «Modo voz» del panel: Dayana habla, el asistente contesta en voz alta y
 * vuelve a escuchar. Puro: decide el siguiente paso a partir del estado, sin
 * tocar el micrófono ni el altavoz (eso lo hace el componente), y se prueba.
 *
 * Reglas que no se negocian:
 * - Nunca se escucha mientras el asistente habla (se oiría a sí mismo).
 * - Una aprobación hablada no aprueba sola: un «sí» claro abre una cuenta
 *   atrás en pantalla, cancelable; lo demás vuelve a preguntar.
 */

export type VoicePhase = "off" | "listening" | "thinking" | "speaking" | "confirming" | "paused";

export type VoiceInputs = {
  enabled: boolean;
  /** El agente está pensando o escribiendo. */
  busy: boolean;
  speaking: boolean;
  listening: boolean;
  /** Hay una cuenta atrás de aprobación por voz en pantalla. */
  confirming: boolean;
  /** Ella pausó la escucha (botón): no se reabre el micrófono solo. */
  paused: boolean;
  /** id de lo pendiente (aprobación o pregunta) que todavía no se leyó en voz alta. */
  unspokenPendingId: string | null;
  /** id del último mensaje del asistente que todavía no se leyó. */
  unspokenReplyId: string | null;
};

export type VoiceAction =
  | { type: "none" }
  | { type: "stop-listening" }
  | { type: "speak-reply"; id: string }
  | { type: "speak-pending"; id: string }
  | { type: "listen" };

export const voicePhase = (s: VoiceInputs): VoicePhase => {
  if (!s.enabled) return "off";
  if (s.confirming) return "confirming";
  if (s.speaking) return "speaking";
  if (s.busy) return "thinking";
  if (s.listening) return "listening";
  return s.paused ? "paused" : "listening";
};

export const nextVoiceAction = (s: VoiceInputs): VoiceAction => {
  if (!s.enabled) return s.listening ? { type: "stop-listening" } : { type: "none" };
  if (s.speaking || s.confirming) return s.listening ? { type: "stop-listening" } : { type: "none" };
  if (s.busy) return s.listening ? { type: "stop-listening" } : { type: "none" };
  // Primero la respuesta, después lo que pide aprobación (la respuesta suele explicarlo).
  if (s.unspokenReplyId) return s.listening ? { type: "stop-listening" } : { type: "speak-reply", id: s.unspokenReplyId };
  if (s.unspokenPendingId) return s.listening ? { type: "stop-listening" } : { type: "speak-pending", id: s.unspokenPendingId };
  if (s.paused || s.listening) return { type: "none" };
  return { type: "listen" };
};

/** Segundos de la cuenta atrás antes de aprobar algo dicho en voz alta. */
export const VOICE_APPROVAL_COUNTDOWN_S = 4;
/** Silencio tras la última palabra con el que se da por terminada la frase. */
export const VOICE_SILENCE_MS = 1600;

type Part = { type: string; text?: string };
type Message = { id: string; role: string; parts: readonly Part[] };

/** El texto del último mensaje del asistente (sus partes de texto, juntas). */
export const lastAssistantText = (messages: readonly Message[]): { id: string; text: string } | null => {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return null;
  const text = last.parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text!.trim())
    .filter(Boolean)
    .join("\n\n");
  return text ? { id: last.id, text } : null;
};

/** Una opción de `ask_question` dicha en voz alta: por su etiqueta o por su número. */
export const matchSpokenOption = (
  transcript: string,
  options: readonly { id: string; label?: string }[]
): string | null => {
  const fold = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const t = fold(transcript);
  if (!t) return null;
  const ordinals = ["primera|primero|uno|1", "segunda|segundo|dos|2", "tercera|tercero|tres|3", "cuarta|cuarto|cuatro|4"];
  for (const [i, words] of ordinals.entries()) {
    if (options[i] && new RegExp(`^(?:la |el |opcion )?(?:${words})(?: opcion)?$`).test(t)) return options[i].id;
  }
  const hits = options.filter((o) => {
    const label = fold(o.label ?? o.id);
    return label && (t === label || t.includes(label));
  });
  return hits.length === 1 ? hits[0].id : null;
};
