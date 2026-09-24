"use client";

import { Loader2, RefreshCw, Search, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  pairsFromExport,
  parseWhatsAppExport,
  type ParsedExport,
} from "@/lib/crm/whatsapp-reply-pairs";
import { useCrm } from "../../crm/CrmProvider";
import { WHATSAPP_AI_API, useSettings, type LearningSummaryDto } from "./context";
import SettingRow, { SettingsGroup } from "./SettingRow";
import { WaSwitch } from "./ToggleRow";

type ExampleRow = {
  id: string;
  source: string;
  clientText: string;
  replyText: string;
  isEnabled: boolean;
  repliedAt: string;
};

type LearnResponse = {
  conversations: number;
  written: number;
  nextCursor: string | null;
  summary: LearningSummaryDto;
};

const post = async <T,>(body: unknown): Promise<{ ok: boolean; data: T }> => {
  const res = await fetch(WHATSAPP_AI_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const data = ((await res?.json().catch(() => ({}))) ?? {}) as T;
  return { ok: !!res?.ok, data };
};

/** Aprender de la bandeja y subir chats exportados. */
const LearningTools = () => {
  const { summary, setSummary } = useSettings();
  const { toast } = useCrm();
  const [busy, setBusy] = useState<null | "learn" | "import">(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedExport | null>(null);
  const [owner, setOwner] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const learn = async () => {
    setBusy("learn");
    let cursor: string | null = null;
    let conversations = 0;
    let written = 0;
    try {
      do {
        const res: { ok: boolean; data: LearnResponse } = await post<LearnResponse>({ action: "learn", cursor });
        if (!res.ok) {
          toast("Se cortó el aprendizaje. Vuelve a intentarlo: sigue donde iba.", "error");
          return;
        }
        conversations += res.data.conversations;
        written += res.data.written;
        cursor = res.data.nextCursor;
        setSummary(res.data.summary);
        setProgress(`${conversations} conversaciones leídas · ${written} respuestas nuevas`);
      } while (cursor);
      toast(`Listo: ${written} respuestas nuevas aprendidas`, "success");
    } finally {
      setBusy(null);
    }
  };

  const readFile = async (f: File) => {
    const result = parseWhatsAppExport(await f.text());
    if (result.messages.length === 0) {
      toast("No reconocí el formato. Exporta el chat «sin archivos» y sube el .txt.", "error");
      return;
    }
    setParsed(result);
    setOwner(result.senders.find((s) => /dayana/i.test(s.name))?.name ?? "");
  };

  const importPairs = async () => {
    if (!parsed || !owner) return;
    const pairs = pairsFromExport(parsed.messages, owner);
    if (pairs.length === 0) {
      toast("No encontré respuestas de esa persona en el chat.", "error");
      return;
    }
    setBusy("import");
    try {
      const { ok, data } = await post<{ written: number; summary: LearningSummaryDto }>({
        action: "import",
        pairs: pairs.slice(0, 2000).map((p) => ({ ...p, repliedAt: p.repliedAt.toISOString() })),
      });
      if (!ok) {
        toast("No se pudo importar.", "error");
        return;
      }
      setSummary(data.summary);
      setParsed(null);
      setOwner("");
      toast(`${data.written} respuestas importadas`, "success");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SettingRow
        id="wa-learn-inbox"
        label="Aprender de la bandeja ahora"
        help={progress ?? "Aprende solo cada vez que respondes; esto repasa todo de una vez."}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{summary.enabled} en uso</Badge>
          <Badge variant="outline">{summary.imported} importadas</Badge>
          {summary.pendingEmbedding > 0 && <Badge variant="outline">{summary.pendingEmbedding} por procesar</Badge>}
          <Button size="sm" variant="outline" onClick={() => void learn()} disabled={busy !== null}>
            {busy === "learn" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {busy === "learn" ? "Aprendiendo…" : "Aprender"}
          </Button>
        </div>
      </SettingRow>
      <SettingRow
        id="wa-import-chat"
        label="Subir un chat exportado"
        help="Archivo .txt de WhatsApp (en iPhone, descomprime el .zip)."
        info="En WhatsApp: abre el chat → ⋮ → Más → Exportar chat → Sin archivos."
        layout={parsed ? "stacked" : "inline"}
      >
        <input
          ref={file}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readFile(f);
            e.target.value = "";
          }}
        />
        {!parsed ? (
          <Button size="sm" variant="outline" onClick={() => file.current?.click()} disabled={busy !== null}>
            <Upload /> Elegir archivo
          </Button>
        ) : (
          <div className="space-y-2 rounded-lg bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{parsed.messages.length} mensajes. ¿Cuál eres tú?</p>
            <div className="flex flex-wrap gap-1.5">
              {parsed.senders.slice(0, 6).map((s) => (
                <Button
                  key={s.name}
                  size="sm"
                  variant={owner === s.name ? "default" : "outline"}
                  onClick={() => setOwner(s.name)}
                >
                  {s.name} ({s.count})
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => void importPairs()}
                disabled={!owner || busy !== null}
                className="bg-[#00a884] text-white hover:bg-[#008069]"
              >
                {busy === "import" && <Loader2 className="animate-spin" />}
                {busy === "import" ? "Importando…" : "Importar respuestas"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setParsed(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </SettingRow>
    </>
  );
};

/** Las respuestas aprendidas: se apagan las que no se deben imitar. */
const Examples = () => {
  const { summary } = useSettings();
  const { toast } = useCrm();
  const [rows, setRows] = useState<ExampleRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");

  const load = useCallback(async (nextPage: number, query: string) => {
    const { ok, data } = await post<{ rows: ExampleRow[]; total: number }>({
      action: "list",
      page: nextPage,
      q: query || undefined,
    });
    if (ok) {
      setRows(data.rows);
      setTotal(data.total);
      setPage(nextPage);
    } else {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load(1, "");
  }, [load, summary.total]);

  const toggle = async (row: ExampleRow) => {
    const { ok } = await post({ action: "toggle", id: row.id, isEnabled: !row.isEnabled });
    if (!ok) {
      toast("No se pudo cambiar.", "error");
      return;
    }
    setRows((all) => (all ?? []).map((r) => (r.id === row.id ? { ...r, isEnabled: !r.isEnabled } : r)));
  };

  const pages = Math.max(1, Math.ceil(total / 20));

  return (
    <SettingRow
      id="wa-examples"
      layout="stacked"
      label="Respuestas aprendidas"
      help="Apaga las que no quieras que imite (p. ej. una respuesta a un familiar)."
    >
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(1, q);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en lo aprendido" aria-label="Buscar respuestas aprendidas" />
        <Button type="submit" variant="outline" aria-label="Buscar">
          <Search />
        </Button>
      </form>
      {rows === null ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay respuestas aprendidas.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <p className="line-clamp-2 text-muted-foreground">{row.clientText}</p>
                <p className={row.isEnabled ? "line-clamp-3" : "line-clamp-3 line-through opacity-60"}>{row.replyText}</p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(row.repliedAt).toLocaleDateString("es-CO")} ·{" "}
                  {row.source === "import" ? "chat importado" : "bandeja"}
                </p>
              </div>
              <WaSwitch checked={row.isEnabled} onCheckedChange={() => void toggle(row)} aria-label="Usar como ejemplo" />
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="mt-2 flex items-center justify-between text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => void load(page - 1, q)}>
            Anterior
          </Button>
          <span className="text-muted-foreground">
            {page} de {pages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => void load(page + 1, q)}>
            Siguiente
          </Button>
        </div>
      )}
    </SettingRow>
  );
};

/** Pestaña «Avanzado»: herramientas de aprendizaje y datos que se guardan. */
const AdvancedTab = () => (
  <div className="space-y-6">
    <SettingsGroup title="Aprendizaje">
      <LearningTools />
      <Examples />
    </SettingsGroup>

    <SettingsGroup title="Datos">
      <SettingRow id="wa-retention" layout="stacked" label="Cuánto tiempo se guardan">
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>• Los chats y sus mensajes no se borran solos.</li>
          <li>• Los avisos técnicos de WhatsApp ya procesados se borran a los 30 días.</li>
          <li>• Los que fallaron se guardan 90 días para poder revisarlos.</li>
        </ul>
      </SettingRow>
    </SettingsGroup>
  </div>
);

export default AdvancedTab;
