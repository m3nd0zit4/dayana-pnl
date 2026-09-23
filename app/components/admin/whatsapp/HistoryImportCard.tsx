"use client";

import { CheckCircle2, History, Loader2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCrm } from "../crm/CrmProvider";

type Status = {
  status: "idle" | "uploading" | "processing" | "done" | "error";
  file?: string;
  events?: number;
  stored?: number;
  conversations?: number;
  error?: string;
  at: string;
};

const PART = 3 * 1024 * 1024;

/**
 * Subir el historial que se descarga del Hub de 360dialog. Para un cliente
 * directo de 360dialog el historial no llega solo: se descarga del Hub y se
 * sube aquí. Con eso la IA aprende cómo escribe Dayana.
 */
const HistoryImportCard = () => {
  const { toast } = useCrm();
  const [status, setStatus] = useState<Status | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/whatsapp/history-import", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setStatus((await res.json()) as Status);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (status?.status !== "processing") return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [status?.status, load]);

  const upload = async (file: File) => {
    const uploadId = crypto.randomUUID();
    const parts = Math.max(1, Math.ceil(file.size / PART));
    try {
      for (let i = 0; i < parts; i++) {
        setProgress(Math.round((i / parts) * 100));
        const res = await fetch(`/api/admin/whatsapp/history-import?upload=${uploadId}&part=${i}`, {
          method: "POST",
          body: file.slice(i * PART, (i + 1) * PART),
        });
        if (!res.ok) throw new Error();
      }
      setProgress(100);
      const res = await fetch(
        `/api/admin/whatsapp/history-import?upload=${uploadId}&done=1&name=${encodeURIComponent(file.name)}`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error();
      toast("Archivo subido. Estamos leyendo los chats…", "success");
      setStatus({ status: "processing", file: file.name, at: new Date().toISOString() });
    } catch {
      toast("No se pudo subir el archivo. Intenta de nuevo.", "error");
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-[#e9edef] bg-white p-4 dark:border-border dark:bg-card">
      <h2 className="flex items-center gap-2 font-semibold">
        <History className="size-5 text-[#00a884]" /> Importar el historial de chats (últimos 6 meses)
      </h2>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-[#54656f]">
        <li>
          Entra al{" "}
          <a href="https://hub.360dialog.com" target="_blank" rel="noreferrer" className="font-medium text-[#008069] hover:underline">
            Hub de 360dialog
          </a>{" "}
          → tu número → <strong>Coexistence</strong> (coexistencia).
        </li>
        <li>Sincroniza el historial de chats y descárgalo.</li>
        <li>Sube aquí el archivo tal como se descargó (.json o .zip).</li>
      </ol>
      <p className="text-xs text-[#667781]">
        La IA lee esos chats, aprende cómo responde Dayana y escribe su guía de estilo sola. Subirlo dos veces no
        duplica nada.
      </p>

      <input
        ref={input}
        type="file"
        accept=".json,.ndjson,.jsonl,.zip,application/json,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={progress !== null || status?.status === "processing"}
        className="inline-flex h-9 items-center gap-2 rounded-full bg-[#00a884] px-4 text-sm font-medium text-white hover:bg-[#008069] disabled:opacity-50"
      >
        {progress !== null ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {progress !== null ? `Subiendo… ${progress}%` : "Subir historial"}
      </button>

      {status?.status === "processing" && (
        <p className="flex items-center gap-2 text-sm text-[#008069]">
          <Loader2 className="size-4 animate-spin" /> Leyendo {status.file ?? "el archivo"}… puede tardar unos minutos.
        </p>
      )}
      {status?.status === "done" && (
        <p className="flex items-center gap-2 text-sm text-[#008069]">
          <CheckCircle2 className="size-4" /> {status.stored ?? 0} mensajes nuevos de {status.conversations ?? 0} chats
          importados ({status.file}). La IA ya aprende de ellos.
        </p>
      )}
      {status?.status === "error" && <p className="text-sm text-[#d92d20]">{status.error}</p>}
    </section>
  );
};

export default HistoryImportCard;
