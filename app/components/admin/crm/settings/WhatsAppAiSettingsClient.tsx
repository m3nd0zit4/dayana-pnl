"use client";

import { useCallback, useEffect, useState } from "react";
import { diffConfig } from "@/lib/crm/whatsapp-agent/config-diff";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Switch } from "@/app/components/ui/switch";
import { Textarea } from "@/app/components/ui/textarea";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import type { WhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import {
  pairsFromExport,
  parseWhatsAppExport,
  type ParsedExport,
} from "@/lib/crm/whatsapp-reply-pairs";

export type LearningSummaryDto = {
  total: number;
  enabled: number;
  pendingEmbedding: number;
  imported: number;
  knownContacts: number;
  lastLearnedAt: string | null;
};

type ExampleRow = {
  id: string;
  source: string;
  clientText: string;
  replyText: string;
  isEnabled: boolean;
  repliedAt: string;
};

type Draft = {
  action: "reply" | "escalate";
  message: string;
  reason: string;
  examples: {
    id: string;
    clientText: string;
    replyText: string;
    similarity: number;
  }[];
};

const API = "/api/admin/settings/whatsapp-ai";

type LearnResponse = {
  conversations: number;
  written: number;
  nextCursor: string | null;
  summary: LearningSummaryDto;
};

const DAYS = [
  { id: 1, label: "L" },
  { id: 2, label: "M" },
  { id: 3, label: "X" },
  { id: 4, label: "J" },
  { id: 5, label: "V" },
  { id: 6, label: "S" },
  { id: 0, label: "D" },
];

const post = async <T,>(body: unknown): Promise<{ ok: boolean; data: T }> => {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, data };
};

const Choice = <T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { id: T; label: string; hint: string }[];
}) => (
  <div className="grid gap-2 sm:grid-cols-2">
    {options.map((o) => (
      <button
        key={o.id}
        type="button"
        onClick={() => onChange(o.id)}
        className={`rounded-lg border p-3 text-left transition-colors ${
          value === o.id
            ? "border-foreground bg-muted/60"
            : "border-border hover:border-foreground/40"
        }`}
      >
        <p className="text-sm font-medium">{o.label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{o.hint}</p>
      </button>
    ))}
  </div>
);

const Section = ({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <Card>
    <CardContent className="space-y-4 py-5">
      <div>
        <p className="font-medium">{title}</p>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </CardContent>
  </Card>
);

const ToggleRow = ({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <div className="flex items-start justify-between gap-4">
    <div>
      <Label htmlFor={id}>{label}</Label>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
    <Switch id={id} checked={checked} onCheckedChange={onChange} />
  </div>
);

/**
 * Todo lo del asistente de WhatsApp en una pantalla: si contesta, a quién,
 * cuándo, cómo, qué ha aprendido de Dayana y un probador que muestra lo que
 * contestaría sin enviar nada.
 */
const WhatsAppAiSettingsClient = ({
  initialConfig,
  initialEnabled,
  initialSummary,
  configured,
}: {
  initialConfig: WhatsAppAiConfig;
  initialEnabled: boolean;
  initialSummary: LearningSummaryDto;
  configured: boolean;
}) => {
  const { toast } = useCrm();
  const [config, setConfig] = useState(initialConfig);
  // Lo último guardado: al guardar se manda solo la diferencia contra esto.
  const [baseline, setBaseline] = useState(initialConfig);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [summary, setSummary] = useState(initialSummary);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | string>(null);

  const update = <K extends keyof WhatsAppAiConfig>(
    key: K,
    value: WhatsAppAiConfig[K]
  ) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    setBusy("save");
    try {
      const res = await fetch(API, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, patch: diffConfig(baseline, config) ?? {} }),
      });
      if (!res.ok) {
        toast(
          "No se pudo guardar. Revisa los horarios y los límites.",
          "error"
        );
        return;
      }
      setDirty(false);
      setBaseline(config);
      toast("Asistente guardado", "success");
    } finally {
      setBusy(null);
    }
  };

  // ── Aprender ───────────────────────────────────────────────────────────
  const [progress, setProgress] = useState<string | null>(null);

  const learn = async () => {
    setBusy("learn");
    let cursor: string | null = null;
    let conversations = 0;
    let written = 0;
    try {
      do {
        const res: { ok: boolean; data: LearnResponse } =
          await post<LearnResponse>({
            action: "learn",
            cursor,
          });
        const { ok, data } = res;
        if (!ok) {
          toast(
            "Se cortó el aprendizaje. Vuelve a intentarlo: sigue donde iba.",
            "error"
          );
          return;
        }
        conversations += data.conversations;
        written += data.written;
        cursor = data.nextCursor;
        setSummary(data.summary);
        setProgress(
          `${conversations} conversaciones leídas · ${written} respuestas nuevas`
        );
      } while (cursor);
      toast(`Listo: ${written} respuestas nuevas aprendidas`, "success");
    } finally {
      setBusy(null);
    }
  };

  const draftStyle = async () => {
    setBusy("style");
    try {
      const { ok, data } = await post<{
        styleGuide?: string;
        message?: string;
      }>({
        action: "style",
      });
      if (!ok || !data.styleGuide) {
        toast(data.message ?? "No se pudo generar la guía.", "error");
        return;
      }
      update("styleGuide", data.styleGuide);
      toast("Guía generada. Revísala y guarda.", "success");
    } finally {
      setBusy(null);
    }
  };

  // ── Importar un chat exportado ─────────────────────────────────────────
  const [parsed, setParsed] = useState<ParsedExport | null>(null);
  const [owner, setOwner] = useState("");

  const readFile = async (file: File) => {
    const text = await file.text();
    const result = parseWhatsAppExport(text);
    if (result.messages.length === 0) {
      toast(
        "No reconocí el formato. Exporta el chat «sin archivos» y sube el .txt.",
        "error"
      );
      return;
    }
    setParsed(result);
    // Quien más responde suele ser Dayana, pero lo confirma ella.
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
      const { ok, data } = await post<{
        written: number;
        summary: LearningSummaryDto;
      }>({
        action: "import",
        pairs: pairs
          .slice(0, 2000)
          .map((p) => ({ ...p, repliedAt: p.repliedAt.toISOString() })),
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

  // ── Probar ─────────────────────────────────────────────────────────────
  const [probe, setProbe] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const runProbe = async () => {
    if (!probe.trim()) return;
    setBusy("probe");
    setDraft(null);
    try {
      const { ok, data } = await post<{ draft?: Draft }>({
        action: "preview",
        message: probe,
        config,
      });
      if (!ok || !data.draft) {
        toast("El modelo no respondió. Intenta de nuevo.", "error");
        return;
      }
      setDraft(data.draft);
    } finally {
      setBusy(null);
    }
  };

  // ── Ejemplos ───────────────────────────────────────────────────────────
  const [rows, setRows] = useState<ExampleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");

  const loadRows = useCallback(async (nextPage: number, query: string) => {
    const { ok, data } = await post<{ rows: ExampleRow[]; total: number }>({
      action: "list",
      page: nextPage,
      q: query || undefined,
    });
    if (ok) {
      setRows(data.rows);
      setTotal(data.total);
      setPage(nextPage);
    }
  }, []);

  useEffect(() => {
    void loadRows(1, "");
  }, [loadRows, summary.total]);

  const toggleRow = async (row: ExampleRow) => {
    const { ok } = await post({
      action: "toggle",
      id: row.id,
      isEnabled: !row.isEnabled,
    });
    if (!ok) {
      toast("No se pudo cambiar.", "error");
      return;
    }
    setRows((all) =>
      all.map((r) => (r.id === row.id ? { ...r, isEnabled: !r.isEnabled } : r))
    );
  };

  const pages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-6">
      <Section
        title="Asistente de WhatsApp"
        hint="Contesta por ti con los datos del CRM y tu forma de escribir. Cuando la conversación se pone personal (dolor, un pago, una queja o algo que no sabe), deja de escribir y te avisa."
      >
        {!configured && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            Falta conectar WhatsApp en Ajustes → Canales del agente.
          </p>
        )}
        <ToggleRow
          id="ai-enabled"
          label="Responder automáticamente"
          hint="Apagado, no escribe nunca. Puedes pausarlo en cada conversación desde la bandeja."
          checked={enabled}
          onChange={(v) => {
            setEnabled(v);
            setDirty(true);
          }}
        />
      </Section>

      <Section title="Cómo se presenta">
        <Choice
          value={config.identity}
          onChange={(v) => update("identity", v)}
          options={[
            {
              id: "assistant",
              label: "Como asistente de Dayana",
              hint: "«Dayana te responde en un momento». Habla de ti en tercera persona.",
            },
            {
              id: "owner",
              label: "Con mi voz",
              hint: "Escribe en primera persona, como tú. Si le preguntan si es un robot, dice la verdad y te pasa el chat.",
            },
          ]}
        />
      </Section>

      <Section
        title="A quién le responde"
        hint="Tu número es el mismo de tu celular: no todo el que escribe es un cliente nuevo."
      >
        <ToggleRow
          id="ai-known"
          label="No responder a mi libreta personal"
          hint={`Contactos guardados en tu celular que no son clientes del CRM, como familia y amigos (${summary.knownContacts} sincronizados). A tus clientes sí les responde, con el historial de su chat.`}
          checked={config.audience.skipKnownContacts}
          onChange={(v) =>
            update("audience", { ...config.audience, skipKnownContacts: v })
          }
        />
        <ToggleRow
          id="ai-customers"
          label="No responder a clientes que ya pagaron"
          hint="Quien tiene un proceso activo o terminado lo atiendes tú."
          checked={config.audience.skipCustomers}
          onChange={(v) =>
            update("audience", { ...config.audience, skipCustomers: v })
          }
        />
      </Section>

      <Section
        title="Agendar citas"
        hint="Pega el enlace de tu página de citas de Google Calendar. El asistente lo comparte cuando alguien quiere agendar, y el saludo lo usa como botón. Cambiar o cancelar una cita siempre te la pasa a ti."
      >
        <div className="space-y-1.5">
          <Label htmlFor="ai-booking">Enlace para agendar</Label>
          <Input
            id="ai-booking"
            type="url"
            inputMode="url"
            placeholder="https://calendar.app.google/…"
            value={config.bookingUrl}
            onChange={(e) => update("bookingUrl", e.target.value.trim())}
          />
          {config.bookingUrl && !/^https:\/\//i.test(config.bookingUrl) && (
            <p className="text-xs text-destructive">
              Debe empezar por https://
            </p>
          )}
          {!config.bookingUrl && (
            <p className="text-xs text-muted-foreground">
              Sin enlace, cuando alguien quiera agendar te pasa la conversación.
            </p>
          )}
        </div>
      </Section>

      <Section title="Cuándo responde">
        <Choice
          value={config.schedule.mode}
          onChange={(v) => update("schedule", { ...config.schedule, mode: v })}
          options={[
            {
              id: "always",
              label: "Siempre",
              hint: "A cualquier hora, todos los días.",
            },
            {
              id: "outside_hours",
              label: "Solo fuera de mi horario",
              hint: "En tu horario contestas tú; de noche y en tus días libres, el asistente.",
            },
          ]}
        />
        {config.schedule.mode === "outside_hours" && (
          <div className="space-y-3">
            <div>
              <Label>Días en que yo atiendo</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {DAYS.map((d) => {
                  const on = config.schedule.days.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() =>
                        update("schedule", {
                          ...config.schedule,
                          days: on
                            ? config.schedule.days.filter((x) => x !== d.id)
                            : [...config.schedule.days, d.id],
                        })
                      }
                      className={`size-9 rounded-md border text-sm ${
                        on
                          ? "border-foreground bg-foreground text-background"
                          : "border-border"
                      }`}
                      aria-pressed={on}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ai-start">Desde</Label>
                <Input
                  id="ai-start"
                  type="time"
                  value={config.schedule.start}
                  onChange={(e) =>
                    update("schedule", {
                      ...config.schedule,
                      start: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-end">Hasta</Label>
                <Input
                  id="ai-end"
                  type="time"
                  value={config.schedule.end}
                  onChange={(e) =>
                    update("schedule", {
                      ...config.schedule,
                      end: e.target.value,
                    })
                  }
                />
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section title="Límites y avisos">
        <div className="space-y-1.5">
          <Label htmlFor="ai-handoff">
            Cuando tú contestas un chat, el asistente vuelve después de (horas)
          </Label>
          <Input
            id="ai-handoff"
            type="number"
            min={0}
            max={168}
            className="w-28"
            value={config.handoffHours}
            onChange={(e) =>
              update(
                "handoffHours",
                Math.min(168, Math.max(0, Number(e.target.value) || 0))
              )
            }
          />
          <p className="text-xs text-muted-foreground">
            Mientras tanto el chat es tuyo. 0 = no vuelve solo; lo reanudas
            desde la bandeja. Si el asistente te pasó el chat (una crisis, un
            pago, una queja), no vuelve solo nunca.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ai-max">
            Máximo de respuestas por conversación en 24 h
          </Label>
          <Input
            id="ai-max"
            type="number"
            min={1}
            max={20}
            className="w-28"
            value={config.maxPerDay}
            onChange={(e) =>
              update(
                "maxPerDay",
                Math.min(20, Math.max(1, Number(e.target.value) || 1))
              )
            }
          />
          <p className="text-xs text-muted-foreground">
            Al llegar al tope, te pasa la conversación.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Cuando te pasa una conversación, avisar a</Label>
          <Choice
            value={config.notify}
            onChange={(v) => update("notify", v)}
            options={[
              {
                id: "ALL",
                label: "Todo el equipo",
                hint: "Según las notificaciones de cada persona.",
              },
              {
                id: "OWNERS",
                label: "Solo a mí",
                hint: "Solo las cuentas de dueña.",
              },
            ]}
          />
        </div>
      </Section>

      <Section
        title="Instrucciones"
        hint="Lo que el asistente debe saber o evitar, en tus palabras. Los precios y enlaces ya los toma del CRM."
      >
        <Textarea
          rows={5}
          maxLength={3000}
          value={config.instructions}
          onChange={(e) => update("instructions", e.target.value)}
          placeholder="Ej.: Las sesiones son por Google Meet. No doy sesiones presenciales. Si alguien pide factura, pídele su cédula y dile que yo se la envío."
        />
      </Section>

      <Section
        title="Tu forma de escribir"
        hint="Cómo saludas, tratas, cierras y qué emojis usas. Genérala desde tus conversaciones y corrígela a tu gusto."
      >
        <Textarea
          rows={7}
          maxLength={4000}
          value={config.styleGuide}
          onChange={(e) => update("styleGuide", e.target.value)}
          placeholder="Aún vacía."
        />
        <Button
          variant="outline"
          onClick={() => void draftStyle()}
          disabled={busy !== null}
        >
          {busy === "style" ? "Generando…" : "Generar desde mis conversaciones"}
        </Button>
      </Section>

      <Section
        title="Aprender de mis conversaciones"
        hint="Guarda tus respuestas reales y, ante cada mensaje nuevo, le muestra al asistente cómo contestaste a mensajes parecidos. Aprende solo cada vez que respondes, desde el celular o desde el CRM."
      >
        <ToggleRow
          id="ai-learning"
          label="Usar mis respuestas como ejemplo"
          hint="Toma el tono y las frases; los precios y fechas siempre salen del CRM."
          checked={config.learning.enabled}
          onChange={(v) =>
            update("learning", { ...config.learning, enabled: v })
          }
        />
        <div className="space-y-1.5">
          <Label htmlFor="ai-examples">Ejemplos por respuesta</Label>
          <Input
            id="ai-examples"
            type="number"
            min={1}
            max={12}
            className="w-28"
            value={config.learning.examples}
            onChange={(e) =>
              update("learning", {
                ...config.learning,
                examples: Math.min(
                  12,
                  Math.max(1, Number(e.target.value) || 1)
                ),
              })
            }
          />
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="outline">{summary.enabled} respuestas en uso</Badge>
          <Badge variant="outline">{summary.imported} importadas</Badge>
          {summary.pendingEmbedding > 0 && (
            <Badge variant="outline">
              {summary.pendingEmbedding} por procesar
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void learn()}
            disabled={busy !== null}
          >
            {busy === "learn" ? "Aprendiendo…" : "Aprender de la bandeja ahora"}
          </Button>
          {progress && (
            <span className="text-xs text-muted-foreground">{progress}</span>
          )}
        </div>

        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <p className="text-sm font-medium">Subir un chat exportado</p>
          <p className="text-xs text-muted-foreground">
            En WhatsApp: abre el chat → ⋮ → Más → Exportar chat → Sin archivos.
            Sube el archivo .txt (en iPhone, descomprime el .zip primero).
          </p>
          <Input
            type="file"
            accept=".txt,text/plain"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
              e.target.value = "";
            }}
          />
          {parsed && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {parsed.messages.length} mensajes. ¿Cuál eres tú?
              </p>
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
              <Button
                onClick={() => void importPairs()}
                disabled={!owner || busy !== null}
              >
                {busy === "import" ? "Importando…" : "Importar respuestas"}
              </Button>
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Probar"
        hint="Escribe como si fueras una clienta. Muestra lo que contestaría con la configuración de esta pantalla, sin enviar nada."
      >
        <Textarea
          rows={3}
          value={probe}
          onChange={(e) => setProbe(e.target.value)}
          placeholder="Hola, ¿cuánto vale la terapia?"
        />
        <Button
          onClick={() => void runProbe()}
          disabled={busy !== null || !probe.trim()}
        >
          {busy === "probe" ? "Pensando…" : "Ver qué contestaría"}
        </Button>
        {draft && (
          <div className="space-y-2 rounded-lg border p-3">
            <Badge
              className={
                draft.action === "reply"
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-warning/40 bg-warning/10 text-warning"
              }
            >
              {draft.action === "reply"
                ? "Contestaría"
                : "Te pasaría la conversación"}
            </Badge>
            <p className="whitespace-pre-wrap text-sm">{draft.message}</p>
            {draft.action === "escalate" && (
              <p className="text-xs text-muted-foreground">
                Motivo: {draft.reason}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {draft.examples.length > 0
                ? `Usó ${draft.examples.length} respuestas tuyas parecidas.`
                : "No encontró respuestas tuyas parecidas."}
            </p>
          </div>
        )}
      </Section>

      <Section
        title="Respuestas aprendidas"
        hint="Apaga las que no quieras que imite (por ejemplo, una respuesta a un familiar)."
      >
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void loadRows(1, q);
          }}
        >
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar"
          />
          <Button type="submit" variant="outline">
            Buscar
          </Button>
        </form>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay respuestas aprendidas.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1 space-y-1 text-sm">
                  <p className="line-clamp-2 text-muted-foreground">
                    {row.clientText}
                  </p>
                  <p
                    className={`line-clamp-3 ${row.isEnabled ? "" : "line-through opacity-60"}`}
                  >
                    {row.replyText}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(row.repliedAt).toLocaleDateString("es-CO")} ·{" "}
                    {row.source === "import" ? "chat importado" : "bandeja"}
                  </p>
                </div>
                <Switch
                  checked={row.isEnabled}
                  onCheckedChange={() => void toggleRow(row)}
                  aria-label="Usar como ejemplo"
                />
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => void loadRows(page - 1, q)}
            >
              Anterior
            </Button>
            <span className="text-muted-foreground">
              {page} de {pages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pages}
              onClick={() => void loadRows(page + 1, q)}
            >
              Siguiente
            </Button>
          </div>
        )}
      </Section>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <Button
          onClick={() => void save()}
          disabled={busy !== null || !dirty}
          className="shadow-lg"
        >
          {busy === "save"
            ? "Guardando…"
            : dirty
              ? "Guardar cambios"
              : "Guardado"}
        </Button>
      </div>
    </div>
  );
};

export default WhatsAppAiSettingsClient;
