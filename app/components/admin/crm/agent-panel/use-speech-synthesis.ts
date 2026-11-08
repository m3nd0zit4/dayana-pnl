import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { splitForSpeech } from "@/lib/voice/speech-text";
import { unlockSpeechSynthesis } from "./voice-mode-request";

/**
 * La voz del asistente en el panel: `speechSynthesis` del navegador. Gratis,
 * sin red propia, funciona en Chrome/Edge/Safari de escritorio y en el
 * teléfono (Android y iPhone). Suena a la voz del sistema, no a una persona:
 * es lo acordado («no tiene que sonar real»).
 */

/** Orden de preferencia: Colombia, luego Latinoamérica, luego cualquier español. */
const LANG_ORDER = ["es-CO", "es-419", "es-US", "es-MX", "es-AR", "es-PE", "es-CL", "es-ES"];

export const pickSpanishVoice = (voices: readonly Pick<SpeechSynthesisVoice, "lang" | "name" | "localService">[]) => {
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  for (const lang of LANG_ORDER) {
    const matches = voices.filter((v) => norm(v.lang) === lang.toLowerCase());
    // Las voces «Google …» / «Natural» suenan mejor que las locales básicas.
    const best = matches.find((v) => /google|natural|neural|online/i.test(v.name)) ?? matches[0];
    if (best) return best;
  }
  return voices.find((v) => norm(v.lang).startsWith("es")) ?? null;
};

const noopSubscribe = () => () => {};

export const useSpeechSynthesis = () => {
  // false en el servidor y en la hidratación; el valor real en el navegador.
  const isSupported = useSyncExternalStore(
    noopSubscribe,
    () => "speechSynthesis" in window,
    () => false
  );
  const [isSpeaking, setIsSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  // Cada `speak` tiene su número: un `cancel` invalida los trozos que faltaban.
  const runRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => {
      voiceRef.current = pickSpanishVoice(window.speechSynthesis.getVoices()) as SpeechSynthesisVoice | null;
    };
    load();
    // Chrome carga las voces tarde (evento), Safari a veces nunca lo dispara.
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", load);
  }, []);

  const cancel = useCallback(() => {
    runRef.current += 1;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  /**
   * iPhone/Safari solo deja hablar si la primera vez sale de un toque. Se llama
   * al encender el modo voz (dentro del clic) con una frase vacía.
   */
  const unlock = useCallback(() => unlockSpeechSynthesis(), []);

  /** Lee el texto entero y resuelve al terminar (o al cancelarse). */
  const speak = useCallback(
    (text: string): Promise<void> =>
      new Promise((resolve) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve();
        const chunks = splitForSpeech(text);
        if (chunks.length === 0) return resolve();
        const synth = window.speechSynthesis;
        synth.cancel();
        const run = ++runRef.current;
        setIsSpeaking(true);
        let i = 0;
        const next = () => {
          if (run !== runRef.current) return resolve();
          if (i >= chunks.length) {
            setIsSpeaking(false);
            return resolve();
          }
          const u = new SpeechSynthesisUtterance(chunks[i++]);
          u.lang = voiceRef.current?.lang ?? "es-CO";
          try {
            if (voiceRef.current) u.voice = voiceRef.current;
          } catch {
            // Una voz que el navegador ya no reconoce: habla con la del idioma.
          }
          u.rate = 1.05;
          u.onend = next;
          // Un error (otra pestaña habló, el sistema lo cortó) no deja el modo voz colgado.
          u.onerror = next;
          try {
            synth.speak(u);
          } catch {
            setIsSpeaking(false);
            resolve();
          }
        };
        next();
      }),
    []
  );

  useEffect(() => cancel, [cancel]);

  return { isSupported, isSpeaking, speak, cancel, unlock };
};
