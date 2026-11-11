"use client";

import Link from "next/link";
import { Card, CardContent } from "@/app/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { Switch } from "@/app/components/ui/switch";
import { CrmField } from "../ui";

/** Lo que se ajusta desde esta pantalla (el tope por conexión no se toca aquí). */
export type FunnelSettingsValue = { enabled: boolean; days: number; perDay: number };

/** Los mismos límites que `parseFunnelConfig` (`lib/crm/call-funnel/rules.ts`). */
const DAYS = [3, 5, 7, 10, 14, 21, 30];
const PER_DAY = [4, 6, 8, 12, 48];

/** Donde Dayana pone su horario de citas: de ahí salen las horas de la página. */
const BOOKING_SETTINGS_HREF = "/admin/whatsapp/ajustes?tab=citas";

/**
 * Una función y no un componente a propósito: `CrmField` le pasa el `id` y los
 * `aria-*` del campo a su hijo directo, que tiene que ser el `Select` (como en
 * «Conexiones MCP»), no un envoltorio que los pierda.
 */
const numberSelect = ({
  value,
  options,
  unit,
  ariaLabel,
  disabled,
  onChange,
}: {
  value: number;
  options: number[];
  unit: (n: number) => string;
  ariaLabel: string;
  disabled: boolean;
  onChange: (n: number) => void;
}) => (
  <Select
    value={String(value)}
    disabled={disabled}
    onValueChange={(next) => {
      const n = Number(next);
      if (typeof next === "string" && Number.isInteger(n) && n !== value) onChange(n);
    }}
  >
    <SelectTrigger aria-label={ariaLabel} className="w-full sm:w-40">
      <SelectValue>{(v) => unit(Number(v))}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      {options.map((n) => (
        <SelectItem key={n} value={String(n)}>
          {unit(n)}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

/**
 * Los ajustes de la página de la llamada gratis, pequeños y al final: abrirla
 * o cerrarla (solo la dueña) y cuántos días y horas se le muestran a la
 * persona. Cada cambio se guarda al hacerlo, sin botón.
 */
const FunnelSettings = ({
  value,
  saving,
  canWrite,
  canOpenClose,
  onChange,
  onToggle,
}: {
  value: FunnelSettingsValue;
  saving: boolean;
  /** Puede cambiar los días y las horas. */
  canWrite: boolean;
  /** Puede abrir o cerrar la página (dueña). */
  canOpenClose: boolean;
  onChange: (patch: Partial<Pick<FunnelSettingsValue, "days" | "perDay">>) => void;
  onToggle: (enabled: boolean) => void;
}) => (
  <Card>
    <CardContent className="space-y-4">
      <h2 className="text-sm font-medium">Ajustes de la página</h2>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Página pública: {value.enabled ? "abierta" : "cerrada"}</p>
          <p className="text-xs text-muted-foreground">
            Cerrada, en /llamada no se puede agendar: se invita a escribir por WhatsApp.
            {canOpenClose ? "" : " Solo la dueña de la cuenta puede abrirla o cerrarla."}
          </p>
        </div>
        <Switch
          checked={value.enabled}
          disabled={!canOpenClose || saving}
          onCheckedChange={(checked) => onToggle(checked)}
          aria-label="Página pública abierta"
          className="mt-0.5"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <CrmField label="Días que se muestran" description="Cuántos días con cupo muestra el calendario de la página.">
          {numberSelect({
            value: value.days,
            options: DAYS,
            unit: (n) => (n === 1 ? "1 día" : `${n} días`),
            ariaLabel: "Días que se muestran",
            disabled: !canWrite || saving,
            onChange: (days) => onChange({ days }),
          })}
        </CrmField>
        <CrmField label="Horas por día" description="Cuántas horas de cada día se ofrecen. «Todas las libres» muestra cada hora disponible de tu agenda.">
          {numberSelect({
            value: value.perDay,
            options: PER_DAY,
            unit: (n) => (n >= 48 ? "Todas las libres" : `${n} horas`),
            ariaLabel: "Horas por día",
            disabled: !canWrite || saving,
            onChange: (perDay) => onChange({ perDay }),
          })}
        </CrmField>
      </div>

      <p className="text-xs text-muted-foreground">
        Las horas salen de tu horario de citas, en WhatsApp → Ajustes →{" "}
        {canOpenClose ? (
          <Link href={BOOKING_SETTINGS_HREF} className="underline underline-offset-4 hover:text-foreground">
            Horarios y citas
          </Link>
        ) : (
          "Horarios y citas"
        )}
        .
      </p>
    </CardContent>
  </Card>
);

export default FunnelSettings;
