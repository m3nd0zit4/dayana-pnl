"use client";

import { strFromU8, unzipSync } from "fflate";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Smartphone, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useCrm } from "../crm/CrmProvider";

const API = "/api/admin/whatsapp/history-export";
/** El límite de un pedido en Vercel es ~4,5 MB: un chat por pedido y con margen. */
const MAX_CHARS = 3_500_000;

type Candidate = { kind: "contact" | "chat"; id: string; name: string; phoneE164: string };

type Preview = {
  fileName: string;
  contactName: string;
  phoneE164: string | null;
  authors: string[];
  dayanaAuthor: string | null;
  messageCount: number;
  firstAt: string | null;
  lastAt: string | null;
  candidates: Candidate[];
  isGroup: boolean;
};

type ImportResult = {
  conversationId: string | null;
  total: number;
  stored: number;
  duplicates: number;
  alreadyInCrm: number;
};

type Row = {
  key: string;
  fileName: string;
  text: string;
  preview: Preview | null;
  phone: string;
  dayana: string;
  state: "reading" | "ready" | "importing" | "done" | "error";
  error?: string;
  result?: ImportResult;
};

const ERRORS: Record<string, string> = {
  invalid_phone: "Revisa el número: con indicativo, p. ej. +57 300 123 4567.",
  no_messages: "No se reconoció ningún mensaje en el archivo.",
  group_chat: "Es un chat de grupo: solo se importan chats de una persona.",
  too_large: "El chat es demasiado grande para subirlo de una vez.",
  unreadable_file: "No se pudo leer el archivo.",
};

const dateFmt = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" });
const range = (p: Preview) =>
  p.firstAt && p.lastAt ? `${dateFmt.format(new Date(p.firstAt))} – ${dateFmt.format(new Date(p.lastAt))}` : "—";

/** Los .txt de lo que se soltó (un .zip de iPhone trae «_chat.txt» adentro). */
const readFiles = async (files: File[]): Promise<{ fileName: string; text: string }[]> => {
  const out: { fileName: string; text: string }[] = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
        filter: (f) => /\.txt$/i.test(f.name) && !f.name.startsWith("__MACOSX"),
      });
      for (const [name, data] of Object.entries(entries)) {
        const inner = name.split("/").pop() ?? name;
        out.push({ fileName: /^_chat\.txt$/i.test(inner) ? file.name : inner, text: strFromU8(data) });
      }
    } else if (/\.txt$/i.test(file.name) || file.type.startsWith("text/")) {
      out.push({ fileName: file.name, text: await file.text() });
    }
  }
  return out;
};

const fieldClass =
  "h-9 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground focus:border-[#00a884] focus:outline-none focus:ring-1 focus:ring-[#00a884] disabled:opacity-60";

/**
 * Chats exportados desde el celular de Dayana → chats reales del CRM. Sirve
 * para lo anterior a la conexión con WhatsApp (el historial de 360dialog solo
 * trae unos meses): los chats aparecen en la bandeja y la IA aprende de ellos.
 */
const PhoneExportImportCard = () => {
  const { toast } = useCrm();
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const input = useRef<HTMLInputElement>(null);

  const patch = (key: string, change: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const addFiles = async (files: File[]) => {
    let texts: { fileName: string; text: string }[];
    try {
      texts = await readFiles(files);
    } catch {
      toast("No se pudo abrir el archivo. Sube el .txt o el .zip tal como lo exportó WhatsApp.", "error");
      return;
    }
    if (texts.length === 0) {
      toast("Sube el .txt (o el .zip) que exporta WhatsApp.", "error");
      return;
    }
    const added: Row[] = texts.map((t) => ({
      key: crypto.randomUUID(),
      fileName: t.fileName,
      text: t.text,
      preview: null,
      phone: "",
      dayana: "",
      state: "reading",
    }));
    setRows((prev) => [...prev, ...added]);

    for (const row of added) {
      if (row.text.length > MAX_CHARS) {
        patch(row.key, { state: "error", error: ERRORS.too_large });
        continue;
      }
      const form = new FormData();
      form.set("action", "preview");
      form.append("files", new Blob([row.text], { type: "text/plain" }), row.fileName);
      const res = await fetch(API, { method: "POST", body: form }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { files?: Preview[]; error?: string } | null;
      const preview = data?.files?.[0];
      if (!res?.ok || !preview) {
        patch(row.key, { state: "error", error: ERRORS[data?.error ?? ""] ?? "No se pudo leer el chat." });
        continue;
      }
      if (preview.messageCount === 0) {
        patch(row.key, { preview, state: "error", error: ERRORS.no_messages });
        continue;
      }
      patch(row.key, {
        preview,
        phone: preview.phoneE164 ?? "",
        dayana: preview.dayanaAuthor ?? "",
        state: preview.isGroup ? "error" : "ready",
        error: preview.isGroup ? ERRORS.group_chat : undefined,
      });
    }
  };

  const importAll = async () => {
    const pending = rows.filter((r) => r.state === "ready" && r.phone.trim());
    if (pending.length === 0) return;
    setRunning(true);
    setProgress({ done: 0, total: pending.length });
    let chats = 0;
    let stored = 0;
    try {
      for (const row of pending) {
        patch(row.key, { state: "importing", error: undefined });
        const res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "import",
            fileName: row.fileName,
            text: row.text,
            phoneE164: row.phone,
            dayanaAuthor: row.dayana || null,
          }),
        }).catch(() => null);
        const data = (await res?.json().catch(() => null)) as (ImportResult & { error?: string }) | null;
        if (!res?.ok || !data || data.error) {
          patch(row.key, { state: "ready", error: ERRORS[data?.error ?? ""] ?? "No se pudo importar. Intenta de nuevo." });
          setProgress((p) => ({ ...p, done: p.done + 1 }));
          continue;
        }
        chats++;
        stored += data.stored;
        patch(row.key, { state: "done", result: data });
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
      if (chats > 0) toast(`${chats} chats importados · ${stored} mensajes nuevos`, "success");
    } finally {
      setRunning(false);
    }
  };

  const ready = rows.filter((r) => r.state === "ready");
  const missingPhone = ready.some((r) => !r.phone.trim());
  const done = rows.filter((r) => r.state === "done");
  const totalStored = done.reduce((n, r) => n + (r.result?.stored ?? 0), 0);

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Smartphone className="size-5 text-[#00a884]" /> Importar chats del celular
      </h2>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>En el celular: abre el chat → ⋮ → Más → Exportar chat → <strong>Sin archivos</strong>.</li>
        <li>Suelta aquí los .txt (o .zip) — puedes subir varios a la vez.</li>
        <li>Revisa el número y quién es Dayana, y toca «Importar».</li>
      </ol>
      <p className="text-xs text-muted-foreground">
        Los chats aparecen en WhatsApp como conversaciones cerradas, sin avisos ni respuestas automáticas, y la IA
        aprende de ellos. Subir el mismo chat otra vez no duplica nada.
      </p>

      <input
        ref={input}
        type="file"
        multiple
        accept=".txt,.zip,text/plain,application/zip"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void addFiles(files);
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length) void addFiles(files);
        }}
        disabled={running}
        className={`flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-sm transition-colors disabled:opacity-50 ${
          dragging
            ? "border-[#00a884] bg-[#00a884]/10 text-[#008069] dark:text-[#00a884]"
            : "border-border text-muted-foreground hover:border-[#00a884] hover:text-foreground"
        }`}
      >
        <Upload className="size-5" />
        <span className="font-medium">Suelta los chats aquí o toca para elegirlos</span>
        <span className="text-xs">.txt o .zip exportados de WhatsApp</span>
      </button>

      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rows.map((row) => {
            const p = row.preview;
            const locked = row.state === "importing" || row.state === "done" || running;
            return (
              <li key={row.key} className="space-y-2 p-3">
                <div className="flex items-start gap-2">
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p?.contactName || row.fileName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p ? `${p.messageCount} mensajes · ${range(p)}` : row.fileName}
                    </p>
                  </div>
                  <RowStatus row={row} />
                  {!locked && (
                    <button
                      type="button"
                      aria-label="Quitar"
                      onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                      className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>

                {p && !p.isGroup && row.state !== "reading" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span>Número de WhatsApp</span>
                      <input
                        value={row.phone}
                        onChange={(e) => patch(row.key, { phone: e.target.value })}
                        placeholder="+57 300 123 4567"
                        inputMode="tel"
                        disabled={locked}
                        className={fieldClass}
                      />
                      {p.candidates.length > 0 && (
                        <select
                          value=""
                          disabled={locked}
                          onChange={(e) => e.target.value && patch(row.key, { phone: e.target.value })}
                          className={fieldClass}
                        >
                          <option value="">¿Es alguien del CRM? Elegir…</option>
                          {p.candidates.map((c) => (
                            <option key={`${c.kind}-${c.id}`} value={c.phoneE164}>
                              {c.name} · {c.phoneE164} {c.kind === "chat" ? "(chat)" : "(contacto)"}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span>Dayana es:</span>
                      <select
                        value={row.dayana}
                        disabled={locked}
                        onChange={(e) => patch(row.key, { dayana: e.target.value })}
                        className={fieldClass}
                      >
                        <option value="">Nadie (solo escribió el contacto)</option>
                        {p.authors.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {row.error && <p className="text-xs text-destructive">{row.error}</p>}
                {row.state === "done" && row.result && (
                  <p className="text-xs text-[#008069] dark:text-[#00a884]">
                    {row.result.stored} mensajes nuevos
                    {row.result.duplicates > 0 && ` · ${row.result.duplicates} ya importados`}
                    {row.result.alreadyInCrm > 0 && ` · ${row.result.alreadyInCrm} ya estaban en el CRM`}
                    {row.result.conversationId && (
                      <>
                        {" · "}
                        <a
                          href={`/admin/whatsapp?conversation=${row.result.conversationId}`}
                          className="font-medium underline"
                        >
                          Ver chat
                        </a>
                      </>
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void importAll()}
            disabled={running || ready.length === 0}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-[#00a884] px-4 text-sm font-medium text-white hover:bg-[#008069] disabled:opacity-50"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {running
              ? `Importando… ${progress.done}/${progress.total}`
              : `Importar ${ready.length} ${ready.length === 1 ? "chat" : "chats"}`}
          </button>
          {missingPhone && !running && (
            <span className="text-xs text-muted-foreground">Los chats sin número no se importan.</span>
          )}
          {done.length > 0 && (
            <span className="text-sm text-[#008069] dark:text-[#00a884]">
              Total: {done.length} chats · {totalStored} mensajes nuevos
            </span>
          )}
        </div>
      )}
    </section>
  );
};

const RowStatus = ({ row }: { row: Row }) => {
  if (row.state === "reading" || row.state === "importing")
    return <Loader2 className="size-4 shrink-0 animate-spin text-[#00a884]" aria-label="Procesando" />;
  if (row.state === "done") return <CheckCircle2 className="size-4 shrink-0 text-[#00a884]" aria-label="Importado" />;
  if (row.state === "error") return <AlertTriangle className="size-4 shrink-0 text-destructive" aria-label="Error" />;
  return null;
};

export default PhoneExportImportCard;
