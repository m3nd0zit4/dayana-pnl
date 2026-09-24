"use client";

import { Loader2, Sparkles, UserRound, Users } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCrm } from "../../crm/CrmProvider";
import WhatsAppPlaybooksCard from "../WhatsAppPlaybooksCard";
import ChoiceCards from "./ChoiceCards";
import { TYPING_DELAY, WHATSAPP_AI_API, useSettings } from "./context";
import { ExpandableText, NumberField } from "./fields";
import SettingRow, { SettingAnchor, SettingsGroup } from "./SettingRow";
import ToggleRow from "./ToggleRow";

const DAYS = [
  { id: 1, label: "L", name: "Lunes" },
  { id: 2, label: "M", name: "Martes" },
  { id: 3, label: "X", name: "Miércoles" },
  { id: 4, label: "J", name: "Jueves" },
  { id: 5, label: "V", name: "Viernes" },
  { id: 6, label: "S", name: "Sábado" },
  { id: 0, label: "D", name: "Domingo" },
];

/** Botones de días (L M X J V S D), compartidos con la pestaña de citas. */
export const DayPicker = ({
  value,
  onToggle,
  disabled,
}: {
  value: number[];
  onToggle: (day: number) => void;
  disabled?: boolean;
}) => (
  <div className="flex flex-wrap gap-1.5">
    {DAYS.map((d) => {
      const on = value.includes(d.id);
      return (
        <button
          key={d.id}
          type="button"
          aria-pressed={on}
          aria-label={d.name}
          title={d.name}
          disabled={disabled}
          onClick={() => onToggle(d.id)}
          className={cn(
            "size-9 rounded-full border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a884] disabled:opacity-50",
            on ? "border-[#00a884] bg-[#00a884] text-white" : "border-border bg-card text-muted-foreground hover:text-foreground"
          )}
        >
          {d.label}
        </button>
      );
    })}
  </div>
);

type Draft = {
  action: "reply" | "escalate";
  message: string;
  reason: string;
  examples: { id: string }[];
};

/** «Probar»: lo que contestaría la IA con estos ajustes, sin enviar nada. */
const Tester = () => {
  const { config, preview } = useSettings();
  const { toast } = useCrm();
  const [probe, setProbe] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!probe.trim()) return;
    setBusy(true);
    setDraft(null);
    try {
      const res = await fetch(WHATSAPP_AI_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", message: probe, config }),
      });
      const data = (await res.json().catch(() => ({}))) as { draft?: Draft };
      if (!res.ok || !data.draft) {
        toast(preview ? "En la vista previa no se puede probar." : "La IA no respondió. Intenta de nuevo.", "error");
        return;
      }
      setDraft(data.draft);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingRow
      id="wa-tester"
      layout="stacked"
      label="Mensaje de prueba"
      help="Escribe como si fueras una clienta. No se envía nada."
    >
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Input value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="Hola, ¿cuánto vale la terapia?" />
        <Button type="submit" disabled={busy || !probe.trim()} className="bg-[#00a884] text-white hover:bg-[#008069]">
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Ver qué contestaría
        </Button>
      </form>
      {draft && (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <Badge
            className={
              draft.action === "reply"
                ? "border-success/40 bg-success/10 text-success"
                : "border-warning/40 bg-warning/10 text-warning"
            }
          >
            {draft.action === "reply" ? "Contestaría" : "Te pasaría el chat"}
          </Badge>
          <p className="text-sm whitespace-pre-wrap">{draft.message}</p>
          {draft.action === "escalate" && <p className="text-xs text-muted-foreground">Motivo: {draft.reason}</p>}
          <p className="text-xs text-muted-foreground">
            {draft.examples.length > 0
              ? `Usó ${draft.examples.length} respuestas tuyas parecidas.`
              : "No encontró respuestas tuyas parecidas."}
          </p>
        </div>
      )}
    </SettingRow>
  );
};

/** Pestaña «IA y respuestas»: a quién, cuándo y cómo contesta la IA. */
const AiTab = () => {
  const { config, change, states, summary, preview } = useSettings();
  const { toast } = useCrm();
  const [generating, setGenerating] = useState(false);
  const s = config.schedule;

  const draftStyle = async () => {
    setGenerating(true);
    try {
      const res = await fetch(WHATSAPP_AI_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "style" }),
      });
      const data = (await res.json().catch(() => ({}))) as { styleGuide?: string; message?: string };
      if (!res.ok || !data.styleGuide) {
        toast(data.message ?? (preview ? "No disponible en la vista previa." : "No se pudo generar la guía."), "error");
        return;
      }
      change("wa-style-guide", "styleGuide", data.styleGuide);
      toast("Guía generada y guardada. Revísala a tu gusto.", "success");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsGroup title="Cómo se presenta">
        <SettingRow
          id="wa-identity"
          layout="stacked"
          label="La IA escribe…"
          state={states["wa-identity"]}
          info="Con tu voz escribe en primera persona. Si alguien pregunta si es un robot, dice la verdad y te pasa el chat."
        >
          <ChoiceCards
            ariaLabel="Cómo se presenta"
            value={config.identity}
            onChange={(v) => change("wa-identity", "identity", v)}
            options={[
              { id: "assistant", label: "Como tu asistente", hint: "«Dayana te responde en un momento».", icon: Users },
              { id: "owner", label: "Con tu voz", hint: "En primera persona, como tú.", icon: UserRound },
            ]}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="A quién responde">
        <ToggleRow
          id="wa-audience-known"
          label="No responder a mi libreta personal"
          help={`Familia y amigos guardados en tu celular (${summary.knownContacts} sincronizados).`}
          info="Contactos guardados en tu celular que no son clientes del CRM. A tus clientes sí les responde, con el historial de su chat."
          state={states["wa-audience-known"]}
          checked={config.audience.skipKnownContacts}
          onChange={(v) => change("wa-audience-known", "audience.skipKnownContacts", v)}
        />
        <ToggleRow
          id="wa-audience-customers"
          label="No responder a clientes que ya pagaron"
          help="Quien tiene un proceso activo o terminado lo atiendes tú."
          state={states["wa-audience-customers"]}
          checked={config.audience.skipCustomers}
          onChange={(v) => change("wa-audience-customers", "audience.skipCustomers", v)}
        />
      </SettingsGroup>

      <SettingsGroup title="Cuándo responde">
        <SettingRow
          id="wa-schedule"
          layout="stacked"
          label="Horario de la IA"
          state={states["wa-schedule"]}
          info="«Solo fuera de mi horario»: en tu horario contestas tú; de noche y en tus días libres, la IA. Un horario que cruza la medianoche también vale."
        >
          <div className="space-y-4">
            <ChoiceCards
              variant="segmented"
              ariaLabel="Cuándo responde"
              value={s.mode}
              onChange={(v) => change("wa-schedule", "schedule.mode", v)}
              options={[
                { id: "always", label: "Siempre" },
                { id: "outside_hours", label: "Solo fuera de mi horario" },
              ]}
            />
            {s.mode === "outside_hours" && (
              <div className="space-y-3 rounded-lg bg-muted/30 p-3">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Días en que atiendes tú</p>
                  <DayPicker
                    value={s.days}
                    onToggle={(d) =>
                      change(
                        "wa-schedule",
                        "schedule.days",
                        s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d]
                      )
                    }
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">De</span>
                  <Input
                    type="time"
                    aria-label="Desde"
                    value={s.start}
                    onChange={(e) => change("wa-schedule", "schedule.start", e.target.value, TYPING_DELAY)}
                    className="w-32"
                  />
                  <span className="text-xs font-medium text-muted-foreground">a</span>
                  <Input
                    type="time"
                    aria-label="Hasta"
                    value={s.end}
                    onChange={(e) => change("wa-schedule", "schedule.end", e.target.value, TYPING_DELAY)}
                    className="w-32"
                  />
                </div>
              </div>
            )}
          </div>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Límites">
        <SettingRow
          id="wa-max-per-day"
          layout="row"
          htmlFor="wa-max-per-day-input"
          label="Respuestas por chat al día"
          help="Al llegar al tope, te pasa el chat."
          state={states["wa-max-per-day"]}
        >
          <NumberField
            id="wa-max-per-day-input"
            min={1}
            max={20}
            value={config.maxPerDay}
            invalid={states["wa-max-per-day"]?.status === "error"}
            onChange={(v) => change("wa-max-per-day", "maxPerDay", v, TYPING_DELAY)}
          />
        </SettingRow>
        <SettingRow
          id="wa-handoff-hours"
          layout="row"
          htmlFor="wa-handoff-input"
          label="Si contestas tú, la IA vuelve tras"
          help="0 = no vuelve sola; la reanudas desde la bandeja."
          info="Mientras tanto el chat es tuyo. Si la IA te pasó el chat (una crisis, un pago, una queja), no vuelve sola nunca."
          state={states["wa-handoff-hours"]}
        >
          <NumberField
            id="wa-handoff-input"
            min={0}
            max={168}
            suffix="horas"
            value={config.handoffHours}
            invalid={states["wa-handoff-hours"]?.status === "error"}
            onChange={(v) => change("wa-handoff-hours", "handoffHours", v, TYPING_DELAY)}
          />
        </SettingRow>
        <SettingRow
          id="wa-holding-message"
          htmlFor="wa-holding-input"
          layout="stacked"
          label="Mensaje al pasarte un chat"
          help="Vacío (recomendado): la IA se calla y respondes tú."
          state={states["wa-holding-message"]}
        >
          <Textarea
            id="wa-holding-input"
            rows={2}
            maxLength={300}
            value={config.escalation.holdingMessage}
            onChange={(e) =>
              change("wa-holding-message", "escalation.holdingMessage", e.target.value, TYPING_DELAY)
            }
            placeholder="Ej.: Ya le paso tu mensaje a Dayana, ella te escribe en un rato."
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Lo que sabe la IA">
        <SettingRow
          id="wa-instructions"
          layout="stacked"
          label="Instrucciones"
          help="Lo que debe saber o evitar. Precios y enlaces ya los toma del CRM."
          state={states["wa-instructions"]}
        >
          <ExpandableText
            id="wa-instructions-input"
            maxLength={3000}
            value={config.instructions}
            emptyText="Sin instrucciones propias."
            placeholder="Ej.: Las sesiones son por Google Meet. No doy sesiones presenciales."
            onChange={(v) => change("wa-instructions", "instructions", v, TYPING_DELAY)}
          />
        </SettingRow>
        <SettingRow
          id="wa-style-guide"
          layout="stacked"
          label="Tu forma de escribir"
          help="Cómo saludas, tratas y cierras, y qué emojis usas."
          state={states["wa-style-guide"]}
        >
          <ExpandableText
            id="wa-style-guide-input"
            rows={8}
            maxLength={4000}
            value={config.styleGuide}
            emptyText="Aún vacía. Genérala desde tus conversaciones."
            onChange={(v) => change("wa-style-guide", "styleGuide", v, TYPING_DELAY)}
            extra={
              <Button size="sm" variant="outline" onClick={() => void draftStyle()} disabled={generating}>
                {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {generating ? "Generando…" : "Generar"}
              </Button>
            }
          />
        </SettingRow>
        <ToggleRow
          id="wa-learning"
          label="Aprender de mis respuestas"
          help={`${summary.enabled} respuestas tuyas en uso como ejemplo.`}
          info="Ante cada mensaje nuevo, le muestra a la IA cómo contestaste a mensajes parecidos. Toma el tono y las frases; precios y fechas siempre salen del CRM. Las herramientas para importar y revisar están en Avanzado."
          state={states["wa-learning"]}
          checked={config.learning.enabled}
          onChange={(v) => change("wa-learning", "learning.enabled", v)}
        />
        {config.learning.enabled && (
          <SettingRow
            id="wa-learning-examples"
          layout="row"
            htmlFor="wa-learning-examples-input"
            label="Ejemplos por respuesta"
            help="Cuántas respuestas parecidas mira antes de contestar."
            state={states["wa-learning-examples"]}
          >
            <NumberField
              id="wa-learning-examples-input"
              min={1}
              max={12}
              value={config.learning.examples}
              invalid={states["wa-learning-examples"]?.status === "error"}
              onChange={(v) => change("wa-learning-examples", "learning.examples", v, TYPING_DELAY)}
            />
          </SettingRow>
        )}
      </SettingsGroup>

      <SettingAnchor id="wa-playbooks">
        <WhatsAppPlaybooksCard />
      </SettingAnchor>

      <SettingsGroup title="Probar">
        <Tester />
      </SettingsGroup>
    </div>
  );
};

export default AiTab;
