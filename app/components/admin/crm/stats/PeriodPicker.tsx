"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/app/components/ui/toggle-group";
import { STATS_PERIODS } from "@/lib/crm/stats/range";
import type { StatsPeriod } from "@/lib/crm/stats/types";

const PERIOD_LABELS: Record<StatsPeriod, string> = {
  "7d": "7 días",
  "30d": "30 días",
  "90d": "90 días",
  "12mo": "12 meses",
  custom: "Personalizado",
};

export type PeriodChange = { period: StatsPeriod; from?: string; to?: string };

type Props = {
  period: StatsPeriod;
  fromKey: string;
  toKey: string;
  onChange: (next: PeriodChange) => void;
};

/**
 * Selector de periodo: `Select` en móvil (<640px, css `sm:hidden`) para que
 * cinco opciones no desborden 390px de ancho, `ToggleGroup` en escritorio.
 * "Personalizado" abre dos fechas + «Aplicar» debajo, en ambos anchos.
 */
const PeriodPicker = ({ period, fromKey, toKey, onChange }: Props) => {
  const [draftFrom, setDraftFrom] = useState(fromKey);
  const [draftTo, setDraftTo] = useState(toKey);

  const selectPreset = (next: StatsPeriod) => {
    if (next === "custom") {
      onChange({ period: "custom", from: draftFrom, to: draftTo });
      return;
    }
    onChange({ period: next });
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
      <div className="sm:hidden">
        <Select value={period} onValueChange={(v) => selectPreset(v as StatsPeriod)}>
          <SelectTrigger className="w-full" aria-label="Periodo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATS_PERIODS.map((p) => (
              <SelectItem key={p} value={p}>
                {PERIOD_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ToggleGroup
        value={[period]}
        onValueChange={(v) => v[0] && selectPreset(v[0] as StatsPeriod)}
        className="hidden sm:flex"
        aria-label="Periodo"
      >
        {STATS_PERIODS.map((p) => (
          <ToggleGroupItem key={p} value={p}>
            {PERIOD_LABELS[p]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {period === "custom" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onChange({ period: "custom", from: draftFrom, to: draftTo });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="stats-period-from" className="text-xs">
              Desde
            </Label>
            <Input
              id="stats-period-from"
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="w-[9.5rem]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="stats-period-to" className="text-xs">
              Hasta
            </Label>
            <Input
              id="stats-period-to"
              type="date"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              className="w-[9.5rem]"
            />
          </div>
          <Button type="submit" size="sm">
            Aplicar
          </Button>
        </form>
      ) : null}
    </div>
  );
};

export default PeriodPicker;
