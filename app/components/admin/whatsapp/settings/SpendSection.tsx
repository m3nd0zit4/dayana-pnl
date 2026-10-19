"use client";

import { useEffect, useState } from "react";
import { Input } from "@/app/components/ui/input";
import { SPEND_LEVELS, SPEND_LEVEL_LABEL, spendLimits, type SpendLevel } from "@/lib/crm/whatsapp-agent/spend";
import ChoiceCards from "./ChoiceCards";
import { TYPING_DELAY, useSettings } from "./context";
import { NumberField } from "./fields";
import SettingRow, { SettingsGroup } from "./SettingRow";

type Window = { runs: number; usd: number; inputTokens: number; cachedTokens: number };
type Summary = { today: Window; week: Window; month: Window; overBudget: boolean };

const usd = (n: number) => `US$${n < 1 ? n.toFixed(2) : n.toFixed(1)}`;

const hintOf = (level: Exclude<SpendLevel, "personalizado">) => {
  const l = SPEND_LEVELS[level];
  return `Lee ${l.recentMessages} mensajes · ${l.examples} ejemplos tuyos · ${l.maxSteps} vueltas`;
};

const OPTIONS: { id: SpendLevel; label: string; hint: string }[] = [
  { id: "ahorro", label: SPEND_LEVEL_LABEL.ahorro, hint: hintOf("ahorro") },
  { id: "equilibrado", label: SPEND_LEVEL_LABEL.equilibrado, hint: hintOf("equilibrado") },
  { id: "completo", label: SPEND_LEVEL_LABEL.completo, hint: `${hintOf("completo")} (lo de siempre)` },
  { id: "personalizado", label: SPEND_LEVEL_LABEL.personalizado, hint: "Tú pones los números" },
];

/**
 * Nivel de gasto de la IA (`spend.ts`): cuánto del chat lee y cuántas vueltas
 * da con las herramientas, el tope diario y lo que van costando las respuestas.
 */
const SpendSection = () => {
  const { config, change, states, preview } = useSettings();
  const [summary, setSummary] = useState<Summary | null>(null);
  const spend = config.spend;
  const limits = spendLimits(config);

  useEffect(() => {
    if (preview) return;
    void fetch("/api/admin/whatsapp/spend", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Summary>) : null))
      .then(setSummary)
      .catch(() => undefined);
  }, [preview]);

  const custom = spend.level === "personalizado";

  return (
    <SettingsGroup
      title="Nivel de gasto"
      description="Lo que más cuesta en cada respuesta son las reglas (fijas, Gemini las cobra al 10 % cuando las tiene en caché). El nivel decide cuánto del chat lee y cuántas vueltas da con las herramientas: cada vuelta vuelve a mandar todo."
    >
      <SettingRow
        id="wa-spend-now"
        layout="stacked"
        label="Lo que van costando las respuestas"
        help="Aproximado, con el precio de lista de Gemini. No incluye las fichas, las notas de voz ni la clasificación de chats."
      >
        <p className="text-sm text-foreground">
          {summary
            ? `Hoy ${usd(summary.today.usd)} (${summary.today.runs} respuestas) · 7 días ${usd(summary.week.usd)} · este mes ${usd(summary.month.usd)}`
            : preview
              ? "—"
              : "Calculando…"}
        </p>
        {summary?.overBudget && (
          <p className="mt-1 text-sm text-muted-foreground">Hoy ya pasó el tope: contesta en «Ahorro» hasta mañana.</p>
        )}
      </SettingRow>
      <SettingRow id="wa-spend-level" layout="stacked" label="Nivel" state={states["wa-spend-level"]}>
        <ChoiceCards<SpendLevel>
          ariaLabel="Nivel de gasto"
          value={spend.level}
          options={OPTIONS}
          onChange={(v) => change("wa-spend-level", "spend.level", v)}
        />
      </SettingRow>
      {custom && (
        <>
          <SettingRow id="wa-spend-messages" layout="row" htmlFor="wa-spend-messages-input" label="Mensajes que lee" help="Los últimos del chat. Entre 20 y 200." state={states["wa-spend-messages"]}>
            <NumberField
              id="wa-spend-messages-input"
              min={20}
              max={200}
              value={config.context.recentMessages}
              onChange={(v) => change("wa-spend-messages", "context.recentMessages", v, TYPING_DELAY)}
            />
          </SettingRow>
          <SettingRow id="wa-spend-examples" layout="row" htmlFor="wa-spend-examples-input" label="Ejemplos tuyos" help="Respuestas parecidas que mira antes de contestar. Entre 1 y 12." state={states["wa-spend-examples"]}>
            <NumberField
              id="wa-spend-examples-input"
              min={1}
              max={12}
              value={config.learning.examples}
              onChange={(v) => change("wa-spend-examples", "learning.examples", v, TYPING_DELAY)}
            />
          </SettingRow>
          <SettingRow id="wa-spend-snippets" layout="row" htmlFor="wa-spend-snippets-input" label="Mensajes viejos del tema" help="De lo más antiguo del chat, lo que toca lo que acaba de escribir. Entre 0 y 10." state={states["wa-spend-snippets"]}>
            <NumberField
              id="wa-spend-snippets-input"
              min={0}
              max={10}
              value={config.context.snippets}
              onChange={(v) => change("wa-spend-snippets", "context.snippets", v, TYPING_DELAY)}
            />
          </SettingRow>
          <SettingRow id="wa-spend-steps" layout="row" htmlFor="wa-spend-steps-input" label="Vueltas con herramientas" help="Como mucho. Con menos de 4 puede no alcanzar a agendar. Entre 3 y 8." state={states["wa-spend-steps"]}>
            <NumberField
              id="wa-spend-steps-input"
              min={3}
              max={8}
              value={spend.maxSteps}
              onChange={(v) => change("wa-spend-steps", "spend.maxSteps", v, TYPING_DELAY)}
            />
          </SettingRow>
        </>
      )}
      {!custom && (
        <p className="text-sm text-muted-foreground">
          Con «{SPEND_LEVEL_LABEL[spend.level]}» lee {limits.recentMessages} mensajes, {limits.examples} ejemplos tuyos y {limits.snippets} mensajes viejos del tema, y da como mucho {limits.maxSteps} vueltas.
        </p>
      )}
      <SettingRow
        id="wa-spend-budget"
        layout="row"
        htmlFor="wa-spend-budget-input"
        label="Tope por día"
        help="En dólares. Pasado el tope, la IA sigue contestando, en «Ahorro», hasta el día siguiente. 0 = sin tope."
        state={states["wa-spend-budget"]}
      >
        <div className="flex items-center gap-2">
          <Input
            id="wa-spend-budget-input"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.1}
            defaultValue={spend.dailyBudgetUsd}
            className="w-24"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 100) {
                change("wa-spend-budget", "spend.dailyBudgetUsd", Math.round(n * 100) / 100, TYPING_DELAY);
              }
            }}
          />
          <span className="text-sm text-muted-foreground">US$</span>
        </div>
      </SettingRow>
    </SettingsGroup>
  );
};

export default SpendSection;
