"use client";

import { strFromU8, unzipSync } from "fflate";
import { AlertTriangle, CheckCircle2, Contact, FileText, Loader2, Smartphone, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { detectBatchOwner } from "@/lib/crm/whatsapp-export-classify";
import { lookupPhone, parseVCards, phoneByName } from "@/lib/vcard";
import { useCrm } from "../crm/CrmProvider";

const API = "/api/admin/whatsapp/history-export";
/** El límite de un pedido en Vercel es ~4,5 MB: un chat por pedido y con margen. */
const MAX_CHARS = 3_500_000;

type Candidate = { kind: "contact" | "chat"; id: string; name: string; phoneE164: string };

type Verdict = "business" | "personal" | "team" | "group" | "empty" | "unknown";

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
  classification: { verdict: Verdict; confidence: number; reasons: string[]; source: "rules" | "ai" };
  decision: "import" | "skip" | "review";
  ignored: boolean;
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
  /** null = falta que Dayana decida. */
  choice: "import" | "skip" | null;
  /** Al no importarlo: marcar el número como personal (la IA nunca le contesta). */
  personal: boolean;
  state: "reading" | "ready" | "importing" | "done" | "skipped" | "error";
  error?: string;
  result?: ImportResult;
};

const ERRORS: Record<string, string> = {
  invalid_phone: "Revisa el número: con indicativo, p. ej. +57 300 123 4567.",
  no_messages: "No se reconoció ningún mensaje en el archivo.",
  group_chat: "Es un chat de grupo: solo se importan chats de una persona.",
  ignored_number: "Es un número personal: no se importa.",
  too_large: "El chat es demasiado grande para subirlo de una vez.",
  unreadable_file: "No se pudo leer el archivo.",
};

const VERDICT_LABEL: Record<Verdict, string> = {
  business: "Trabajo",
  personal: "Personal",
  team: "Equipo",
  group: "Grupo",
  empty: "Casi vacío",
  unknown: "Sin decidir",
};

const dateFmt = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" });
const range = (p: Preview) =>
  p.firstAt && p.lastAt ? `${dateFmt.format(new Date(p.firstAt))} – ${dateFmt.format(new Date(p.lastAt))}` : "—";

type Loaded = { chats: { fileName: string; text: string }[]; vcards: string[] };

/** Los .txt de lo que se soltó (un .zip de iPhone trae «_chat.txt» adentro) y los .vcf de contactos. */
const readFiles = async (files: File[]): Promise<Loaded> => {
  const out: Loaded = { chats: [], vcards: [] };
  for (const file of files) {
    if (/\.vcf$/i.test(file.name) || file.type === "text/vcard" || file.type === "text/x-vcard") {
      out.vcards.push(await file.text());
    } else if (/\.zip$/i.test(file.name)) {
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
        filter: (f) => /\.txt$/i.test(f.name) && !f.name.startsWith("__MACOSX"),
      });
      for (const [name, data] of Object.entries(entries)) {
        const inner = name.split("/").pop() ?? name;
        out.chats.push({ fileName: /^_chat\.txt$/i.test(inner) ? file.name : inner, text: strFromU8(data) });
      }
    } else if (/\.txt$/i.test(file.name) || file.type.startsWith("text/")) {
      out.chats.push({ fileName: file.name, text: await file.text() });
    }
  }
  return out;
};

const fieldClass =
  "h-9 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground focus:border-[#00a884] focus:outline-none focus:ring-1 focus:ring-[#00a884] disabled:opacity-60";

const choiceOf = (p: Preview): Row["choice"] => (p.decision === "import" ? "import" : p.decision === "skip" ? "skip" : null);

/**
 * Chats exportados desde el celular de Dayana → chats reales del CRM. Sirve
 * para lo anterior a la conexión con WhatsApp: los chats aparecen en la
 * bandeja, la IA lee el historial de cada persona y aprende de Dayana.
 *
 * Cada chat se clasifica ANTES de subirlo: lo de trabajo se importa, lo
 * personal (familia, amigos) no se sube nunca, y lo dudoso lo decide Dayana.
 * Los contactos (.vcf) se leen solo aquí, en el navegador: sirven para saber
 * el número de un chat que solo trae el nombre.
 */
const PhoneExportImportCard = () => {
  const { toast } = useCrm();
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [contacts, setContacts] = useState<Map<string, string>>(new Map());
  const input = useRef<HTMLInputElement>(null);

  const patch = (key: string, change: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...change } : r)));

  /** Completa lo que falta con la tanda entera: quién es Dayana y números del .vcf. */
  const fillFromBatch = (map: Map<string, string>) =>
    setRows((prev) => {
      const owner = detectBatchOwner(prev.flatMap((r) => (r.preview ? [r.preview.authors] : [])));
      return prev.map((r) => {
        if (!r.preview || r.state !== "ready") return r;
        const dayana = r.dayana || (owner && r.preview.authors.includes(owner) ? owner : "");
        const phone = r.phone || (map.size ? (lookupPhone(map, r.preview.contactName) ?? "") : "");
        return dayana === r.dayana && phone === r.phone ? r : { ...r, dayana, phone };
      });
    });

  const addFiles = async (files: File[]) => {
    let loaded: Loaded;
    try {
      loaded = await readFiles(files);
    } catch {
      toast("No se pudo abrir el archivo. Sube el .txt o el .zip tal como lo exportó WhatsApp.", "error");
      return;
    }
    let map = contacts;
    if (loaded.vcards.length) {
      map = new Map([...contacts, ...phoneByName(loaded.vcards.flatMap(parseVCards))]);
      setContacts(map);
      toast(`${map.size} contactos leídos (solo en este navegador)`, "success");
    }
    if (loaded.chats.length === 0) {
      if (!loaded.vcards.length) toast("Sube el .txt (o el .zip) que exporta WhatsApp.", "error");
      fillFromBatch(map);
      return;
    }
    const added: Row[] = loaded.chats.map((t) => ({
      key: crypto.randomUUID(),
      fileName: t.fileName,
      text: t.text,
      preview: null,
      phone: "",
      dayana: "",
      choice: null,
      personal: false,
      state: "reading",
    }));
    setRows((prev) => [...prev, ...added]);

    // Dos a la vez: la clasificación con IA tarda un poco por chat.
    const queue = [...added];
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
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
          phone: preview.phoneE164 ?? (map.size ? (lookupPhone(map, preview.contactName) ?? "") : ""),
          dayana: preview.dayanaAuthor ?? "",
          choice: choiceOf(preview),
          personal: preview.classification.verdict === "personal" && !preview.ignored,
          state: "ready",
        });
      }
    };
    await Promise.all([worker(), worker()]);
    fillFromBatch(map);
  };

  const run = async () => {
    const toImport = rows.filter((r) => r.state === "ready" && r.choice === "import" && r.phone.trim());
    const toIgnore = rows.filter((r) => r.state === "ready" && r.choice === "skip" && r.personal && r.phone.trim());
    const toSkip = rows.filter((r) => r.state === "ready" && r.choice === "skip" && !(r.personal && r.phone.trim()));
    if (toImport.length + toIgnore.length + toSkip.length === 0) return;
    setRunning(true);
    setProgress({ done: 0, total: toImport.length + toIgnore.length });
    let chats = 0;
    let stored = 0;
    try {
      // Lo personal primero: si el número queda ignorado, no se importa por error.
      for (const row of toIgnore) {
        const res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ignore", phoneE164: row.phone }),
        }).catch(() => null);
        patch(row.key, res?.ok ? { state: "skipped" } : { error: "No se pudo marcar como personal. Intenta de nuevo." });
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
      for (const row of toSkip) patch(row.key, { state: "skipped" });
      for (const row of toImport) {
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
      const parts = [
        chats > 0 && `${chats} chats importados · ${stored} mensajes nuevos`,
        toIgnore.length > 0 && `${toIgnore.length} números personales`,
      ].filter(Boolean);
      if (parts.length) toast(parts.join(" · "), "success");
    } finally {
      setRunning(false);
    }
  };

  const ready = rows.filter((r) => r.state === "ready");
  const importable = ready.filter((r) => r.choice === "import" && r.phone.trim());
  const undecided = ready.filter((r) => r.choice === null);
  const missingPhone = ready.some((r) => r.choice === "import" && !r.phone.trim());
  const done = rows.filter((r) => r.state === "done");
  const totalStored = done.reduce((n, r) => n + (r.result?.stored ?? 0), 0);
  // Primero lo que falta decidir, luego lo que se importa, al final lo que no.
  const order = (r: Row) => (r.state !== "ready" ? 3 : r.choice === null ? 0 : r.choice === "import" ? 1 : 2);
  const sorted = [...rows].sort((a, b) => order(a) - order(b));
  const pending = ready.filter((r) => r.choice !== null).length;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Smartphone className="size-5 text-[#00a884]" /> Importar chats del celular
      </h2>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          En el celular: abre el chat → ⋮ → Más → Exportar chat → <strong>Sin archivos</strong>. Empieza por tus clientas,
          luego quienes te escribieron en los últimos 6 meses.
        </li>
        <li>Suelta aquí los .txt (o .zip), muchos a la vez. Si quieres, suelta también tus contactos (.vcf).</li>
        <li>Revisa lo que dice «Sin decidir» y toca «Importar».</li>
      </ol>
      <p className="text-xs text-muted-foreground">
        Cada chat se clasifica antes de subirlo: lo de trabajo se importa; lo personal (familia, amigos) no se sube
        nunca y, si lo marcas, la IA nunca le contesta a ese número. Los chats importados aparecen cerrados, sin avisos ni
        respuestas automáticas. Subir el mismo chat otra vez no duplica nada. Los contactos del .vcf no salen de este
        navegador.
      </p>

      <input
        ref={input}
        type="file"
        multiple
        accept=".txt,.zip,.vcf,text/plain,application/zip,text/vcard,text/x-vcard"
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
        <span className="text-xs">.txt o .zip exportados de WhatsApp · .vcf de contactos (opcional)</span>
      </button>
      {contacts.size > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Contact className="size-3.5" /> {contacts.size} contactos para completar números
        </p>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {sorted.map((row) => {
            const p = row.preview;
            const locked = row.state !== "ready" || running;
            const c = p?.classification;
            return (
              <li key={row.key} className="space-y-2 p-3">
                <div className="flex items-start gap-2">
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p?.contactName || row.fileName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p ? `${p.messageCount} mensajes · ${range(p)}` : row.fileName}
                    </p>
                    {c && row.state !== "error" && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span
                          className={`mr-1 rounded-full px-1.5 py-0.5 font-medium ${
                            p?.ignored
                              ? "bg-muted text-foreground"
                              : row.choice === null
                                ? "bg-warning/15 text-foreground"
                                : row.choice === "import"
                                  ? "bg-[#00a884]/15 text-[#008069] dark:text-[#00a884]"
                                  : "bg-muted text-foreground"
                          }`}
                        >
                          {p?.ignored ? "Número personal" : VERDICT_LABEL[c.verdict]}
                        </span>
                        {c.reasons[0]}
                        {c.source === "ai" && " (según la IA)"}
                      </p>
                    )}
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

                {p && !p.isGroup && !p.ignored && row.state === "ready" && (
                  <div className="flex flex-wrap items-center gap-2" role="group" aria-label="¿Importar este chat?">
                    {(["import", "skip"] as const).map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        disabled={running}
                        aria-pressed={row.choice === choice}
                        onClick={() => patch(row.key, { choice, personal: choice === "skip" ? row.personal : false })}
                        className={`h-8 rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-50 ${
                          row.choice === choice
                            ? "border-foreground bg-foreground text-background"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {choice === "import" ? "Importar" : "No importar"}
                      </button>
                    ))}
                    {row.choice === "skip" && (
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={row.personal}
                          disabled={running || !row.phone.trim()}
                          onChange={(e) => patch(row.key, { personal: e.target.checked })}
                        />
                        Es personal: la IA nunca le contesta{!row.phone.trim() && " (falta el número)"}
                      </label>
                    )}
                  </div>
                )}

                {p && !p.isGroup && !p.ignored && row.state === "ready" && row.choice !== "skip" && (
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
                          {p.candidates.map((cand) => (
                            <option key={`${cand.kind}-${cand.id}`} value={cand.phoneE164}>
                              {cand.name} · {cand.phoneE164} {cand.kind === "chat" ? "(chat)" : "(contacto)"}
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
                {row.state === "skipped" && (
                  <p className="text-xs text-muted-foreground">
                    No se importó{row.personal ? " · número marcado como personal" : ""}.
                  </p>
                )}
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
            onClick={() => void run()}
            disabled={running || pending === 0}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-[#00a884] px-4 text-sm font-medium text-white hover:bg-[#008069] disabled:opacity-50"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {running
              ? `Procesando… ${progress.done}/${progress.total}`
              : `Importar ${importable.length} ${importable.length === 1 ? "chat" : "chats"}`}
          </button>
          {undecided.length > 0 && !running && (
            <span className="text-xs text-muted-foreground">
              {undecided.length} sin decidir: no se tocan hasta que elijas.
            </span>
          )}
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
