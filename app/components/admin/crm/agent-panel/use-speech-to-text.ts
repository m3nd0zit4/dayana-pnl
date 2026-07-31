import { useCallback, useEffect, useRef, useState } from "react";

export const STT_LANGUAGES = [
  { code: "es-CO", label: "Español (Colombia)" },
  { code: "es-ES", label: "Español (España)" },
  { code: "en-US", label: "English (US)" },
  { code: "pt-BR", label: "Português (Brasil)" },
] as const;

export type SttLanguage = (typeof STT_LANGUAGES)[number]["code"];

const STORAGE_KEY = "agent-panel:stt-lang";

const readStoredLanguage = (): SttLanguage => {
  if (typeof window === "undefined") return "es-CO";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return (STT_LANGUAGES.find((l) => l.code === stored)?.code ?? "es-CO") as SttLanguage;
};

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Permiso de micrófono denegado. Habilítalo en los ajustes del navegador.",
  "service-not-allowed": "Permiso de micrófono denegado. Habilítalo en los ajustes del navegador.",
  network: "Sin conexión al servicio de dictado. Revisa tu internet e intenta de nuevo.",
  "no-speech": "No se detectó voz. Intenta de nuevo.",
  "audio-capture": "No se encontró un micrófono disponible.",
  aborted: "Dictado cancelado.",
};

const MEDIA_ERROR_MESSAGES: Record<string, string> = {
  NotAllowedError: "Permiso de micrófono denegado. Habilítalo en los ajustes del navegador.",
  NotFoundError: "No se encontró un micrófono disponible.",
  NotReadableError: "El micrófono está siendo usado por otra aplicación.",
};


/** `onTranscript` fires on every recognition event — interim and final alike —
 * with the full text spoken so far this session, so callers can render it live. */
export const useSpeechToText = (onTranscript: (text: string) => void) => {
  const [language, setLanguageState] = useState<SttLanguage>(readStoredLanguage);
  const [isRecording, setIsRecording] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Overall mic volume (0..1) for the recording-state waveform, resampled
  // from the analyser on every animation frame. 0 whenever not recording, so
  // callers can render it unconditionally.
  const [volume, setVolume] = useState(0);
  // Starts false to match SSR output exactly, then flips in an effect —
  // effects only run post-hydration, so this never disagrees with the
  // server-rendered HTML the way a `typeof window` branch in the initial
  // render would (that's what was causing the hydration mismatch here).
  const [isSupported, setIsSupported] = useState(false);
  useEffect(() => {
    setIsSupported(Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition));
  }, []);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  // Web Speech API exposes no audio data of its own, so the volume bars run
  // off a second, independent tap on the same microphone via Web Audio.
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopAudioAnalysis = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setVolume(0);
  }, []);

  const setLanguage = useCallback((next: SttLanguage) => {
    setLanguageState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    stopAudioAnalysis();
  }, [stopAudioAnalysis]);

  const start = useCallback(async () => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;

    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      // Non-secure context (plain http, not localhost) or a browser without
      // the API at all — getUserMedia doesn't exist here, so there's no
      // prompt to force. This is the one case a permission reset can't fix.
      setError("El navegador no permite dictado por voz aquí (requiere HTTPS o localhost).");
      return;
    }

    // SpeechRecognition.start() alone doesn't reliably surface the browser's
    // native mic permission prompt on every engine — requesting getUserMedia
    // first is the standard way to force that prompt when permission is still
    // in its default "ask" state. Unlike before, the stream is kept open: the
    // volume-bar visualizer taps it independently via Web Audio, since
    // SpeechRecognition itself exposes no audio data.
    setIsRequesting(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setError(MEDIA_ERROR_MESSAGES[name] ?? "No se pudo acceder al micrófono.");
      setIsRequesting(false);
      return;
    }
    setIsRequesting(false);
    streamRef.current = stream;

    const recognition = new Ctor();
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    // Final segments accumulate for the whole session; interim is redone
    // each event from resultIndex onward. Reporting final+interim together
    // on every event (not just once a phrase finalizes) is what makes the
    // textarea update live while the user is still speaking.
    let finalTranscript = "";
    // A stopped recognition instance can still fire a late onresult/onend
    // after toggle() has already created and swapped in a new one — each
    // handler closes over its own `recognition`/`finalTranscript`, so a late
    // event would replay stale text into the current input. Guard every
    // handler on still being the live instance before acting.
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results.item(i);
        const transcript = result.item(0).transcript;
        if (result.isFinal) finalTranscript += transcript;
        else interim += transcript;
      }
      const combined = (finalTranscript + interim).trim();
      if (combined) onTranscriptRef.current(combined);
    };
    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return;
      setError(ERROR_MESSAGES[event.error] ?? `Error de dictado: ${event.error}`);
      setIsRecording(false);
      stopAudioAnalysis();
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      setIsRecording(false);
      stopAudioAnalysis();
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsRecording(true);
    } catch {
      // start() throws InvalidStateError if a recognition session is already
      // active on this instance (e.g. a fast double-click) — nothing to recover.
      setIsRecording(false);
      stopAudioAnalysis();
      return;
    }

    // Sample the analyser's overall level on every frame. Guarded on still
    // being the live recognition instance for the same reason the
    // recognition handlers are — a late frame from a stream that's already
    // been torn down must not resurrect the waveform.
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctx) return;
    const audioCtx = new Ctx();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (recognitionRef.current !== recognition) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      setVolume(Math.min(1, sum / data.length / 160));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [language, stopAudioAnalysis]);

  const toggle = useCallback(() => {
    if (isRecording) stop();
    else void start();
  }, [isRecording, start, stop]);

  useEffect(() => stop, [stop]);

  return { isSupported, isRecording, isRequesting, language, setLanguage, toggle, stop, volume, error };
};
