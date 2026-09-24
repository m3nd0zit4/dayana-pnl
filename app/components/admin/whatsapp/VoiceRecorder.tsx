"use client";

import { Loader2, Mic, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { webmToOgg } from "@/lib/audio/webm-to-ogg";

/** Formatos que WhatsApp acepta directo, en orden de preferencia. */
const PREFERRED = ["audio/ogg;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus"];

const pickMime = (): string | undefined =>
  typeof MediaRecorder === "undefined"
    ? undefined
    : PREFERRED.find((m) => MediaRecorder.isTypeSupported(m));

/**
 * Grabar y mandar una nota de voz, como en WhatsApp: se toca el micrófono,
 * se habla, y se envía o se descarta. Lo que graba Chrome (WebM) se convierte
 * a Ogg/Opus antes de subirlo, que es lo que WhatsApp muestra como nota de voz.
 */
const VoiceRecorder = ({
  disabled,
  onRecorded,
}: {
  disabled?: boolean;
  onRecorded: (file: File) => Promise<void>;
}) => {
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const discard = useRef(false);

  useEffect(() => {
    if (state !== "recording") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), []);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      discard.current = false;
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (discard.current) {
          setState("idle");
          return;
        }
        setState("sending");
        try {
          const type = rec.mimeType || mimeType || "audio/webm";
          const blob = new Blob(chunks.current, { type });
          let file: File;
          if (type.startsWith("audio/webm")) {
            const ogg = webmToOgg(new Uint8Array(await blob.arrayBuffer()));
            file = new File([ogg.buffer as ArrayBuffer], "nota-de-voz.ogg", { type: "audio/ogg" });
          } else if (type.startsWith("audio/ogg")) {
            file = new File([blob], "nota-de-voz.ogg", { type: "audio/ogg" });
          } else {
            file = new File([blob], "nota-de-voz.m4a", { type: "audio/mp4" });
          }
          await onRecorded(file);
        } catch {
          setError("No se pudo preparar la nota de voz.");
        } finally {
          setState("idle");
        }
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setState("recording");
    } catch {
      setError("El navegador no dio permiso para usar el micrófono.");
    }
  };

  const stop = (send: boolean) => {
    discard.current = !send;
    recorder.current?.stop();
  };

  if (state === "recording") {
    return (
      <div className="flex h-[42px] items-center gap-1 rounded-full bg-(--wa-surface) px-1">
        <button type="button" onClick={() => stop(false)} aria-label="Descartar" className="grid size-10 place-items-center rounded-full text-(--wa-icon) hover:text-(--wa-danger)">
          <Trash2 className="size-5" />
        </button>
        <span className="size-2.5 animate-pulse rounded-full bg-(--wa-danger)" />
        <span className="w-12 text-sm tabular-nums text-(--wa-text)">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={() => stop(true)}
          aria-label="Enviar nota de voz"
          className="grid size-10 place-items-center rounded-full bg-(--wa-green) text-white hover:bg-(--wa-green-strong)"
        >
          <Send className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={() => void start()}
        disabled={disabled || state === "sending"}
        aria-label="Grabar nota de voz"
        title="Grabar nota de voz"
        className="grid size-[42px] shrink-0 place-items-center rounded-full bg-(--wa-green) text-white hover:bg-(--wa-green-strong) disabled:opacity-40"
      >
        {state === "sending" ? <Loader2 className="size-5 animate-spin" /> : <Mic className="size-5" />}
      </button>
      {error && <span className="mt-1 text-[11px] text-(--wa-danger)">{error}</span>}
    </div>
  );
};

export default VoiceRecorder;
