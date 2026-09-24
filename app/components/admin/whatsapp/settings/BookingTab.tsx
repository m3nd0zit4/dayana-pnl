"use client";

import { CalendarDays, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import type { WhatsAppBookingConfig } from "@/lib/crm/whatsapp-ai-config";
import { TYPING_DELAY, useSettings } from "./context";
import { NumberField } from "./fields";
import SettingRow, { SettingsGroup } from "./SettingRow";
import ToggleRow, { WaSwitch } from "./ToggleRow";

export type CalendarAccountDto = { id: string; email: string | null; displayName: string | null };

const AUTO = "__auto";

const WEEKDAYS = [
  { id: 1, name: "Lunes" },
  { id: 2, name: "Martes" },
  { id: 3, name: "Miércoles" },
  { id: 4, name: "Jueves" },
  { id: 5, name: "Viernes" },
  { id: 6, name: "Sábado" },
  { id: 0, name: "Domingo" },
];

type Hours = WhatsAppBookingConfig["hours"];

/**
 * Pestaña «Horarios y citas»: todo lo que la IA necesita para agendar, en un
 * solo lugar (antes estaba repartido entre Ajustes y Agenda).
 */
const BookingTab = ({ accounts }: { accounts: CalendarAccountDto[] }) => {
  const { config, change, states } = useSettings();
  const b = config.booking;
  const off = !b.enabled;

  const setHours = (hours: Hours) =>
    change(
      "wa-booking-hours",
      "booking.hours",
      [...hours].sort((x, y) => x.weekday - y.weekday || x.from.localeCompare(y.from)),
      TYPING_DELAY
    );

  const setServices = (services: WhatsAppBookingConfig["services"], delay = 0) =>
    change("wa-booking-services", "booking.services", services, delay);

  const accountLabel = (id: string) => {
    if (id === AUTO) return accounts.length > 1 ? "Sin elegir" : "Automático (la única conectada)";
    const a = accounts.find((x) => x.id === id);
    return a ? (a.email ?? a.displayName ?? "Cuenta de Google") : "Cuenta desconectada";
  };

  return (
    <div className="space-y-6">
      <SettingsGroup
        title="Citas por WhatsApp"
        action={
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link href="/admin/whatsapp/agenda" />}
            className="text-[#008069] dark:text-[#00a884]"
          >
            <CalendarDays /> Ver agenda
          </Button>
        }
      >
        <ToggleRow
          id="wa-booking-enabled"
          label="La IA agenda citas sola"
          help={b.enabled ? "Agenda en tu Google Calendar y confirma con la persona." : "Te pasa a ti las citas."}
          info="Cambiar o cancelar una cita siempre te la pasa a ti. Si hay bloques «Disponible» en tu calendario, la IA usa esos en vez del horario de abajo."
          state={states["wa-booking-enabled"]}
          checked={b.enabled}
          onChange={(v) => change("wa-booking-enabled", "booking.enabled", v)}
        />
        <SettingRow
          id="wa-booking-account"
          label="Calendario de Google"
          help={
            accounts.length === 0 ? (
              <>
                No hay ninguno conectado.{" "}
                <Link href="/admin/ajustes/google" className="font-medium underline">
                  Conectar Google
                </Link>
              </>
            ) : accounts.length > 1 && !b.accountId ? (
              <span className="text-destructive">Tienes varias cuentas: elige una o la IA no podrá agendar.</span>
            ) : (
              "Dónde crea las citas."
            )
          }
          state={states["wa-booking-account"]}
        >
          <Select
            value={b.accountId || AUTO}
            onValueChange={(v) => change("wa-booking-account", "booking.accountId", v === AUTO || !v ? "" : String(v))}
            disabled={accounts.length === 0}
          >
            <SelectTrigger className="w-full sm:w-64" aria-label="Calendario de Google">
              <SelectValue>{(v: string) => accountLabel(v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>{accountLabel(AUTO)}</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {accountLabel(a.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          id="wa-booking-url"
          htmlFor="wa-booking-url-input"
          label="Enlace para agendar"
          help="Tu página de citas de Google. La IA lo comparte si no agenda ella."
          state={states["wa-booking-url"]}
        >
          <Input
            id="wa-booking-url-input"
            type="url"
            inputMode="url"
            placeholder="https://calendar.app.google/…"
            value={config.bookingUrl}
            aria-invalid={states["wa-booking-url"]?.status === "error" || undefined}
            onChange={(e) => change("wa-booking-url", "bookingUrl", e.target.value.trim(), TYPING_DELAY)}
            className="w-full sm:w-72"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Qué se puede agendar" className={off ? "opacity-60" : undefined}>
        <SettingRow
          id="wa-booking-services"
          layout="stacked"
          label="Servicios y duración"
          help="La IA elige según la conversación."
          state={states["wa-booking-services"]}
        >
          <ul className="space-y-2">
            {b.services.map((svc, i) => (
              <li key={i} className="flex items-center gap-2">
                <Input
                  aria-label="Nombre del servicio"
                  value={svc.name}
                  onChange={(e) =>
                    setServices(
                      b.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      TYPING_DELAY
                    )
                  }
                  className="min-w-0 flex-1 sm:max-w-xs"
                />
                <NumberField
                  min={10}
                  max={240}
                  suffix="min"
                  value={svc.minutes}
                  onChange={(v) =>
                    setServices(
                      b.services.map((x, j) => (j === i ? { ...x, minutes: v } : x)),
                      TYPING_DELAY
                    )
                  }
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Quitar ${svc.name}`}
                  disabled={b.services.length <= 1}
                  onClick={() => setServices(b.services.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          {b.services.length < 12 && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => setServices([...b.services, { name: "Nuevo servicio", minutes: 60 }])}
            >
              <Plus /> Agregar servicio
            </Button>
          )}
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Cuándo se puede agendar" className={off ? "opacity-60" : undefined}>
        <SettingRow
          id="wa-booking-hours"
          layout="stacked"
          label="Horario de citas (hora de Colombia)"
          info="Solo se usa si no hay bloques «Disponible» en tu Google Calendar."
          state={states["wa-booking-hours"]}
        >
          <ul className="divide-y divide-border/60">
            {WEEKDAYS.map(({ id: weekday, name }) => {
              const range = b.hours.find((h) => h.weekday === weekday);
              const others = b.hours.filter((h) => h.weekday !== weekday);
              const sameDayExtra = b.hours.filter((h) => h.weekday === weekday).slice(1);
              const update = (next: { from?: string; to?: string } | null) =>
                setHours([
                  ...others,
                  ...(next ? [{ weekday, from: "08:00", to: "18:00", ...range, ...next }, ...sameDayExtra] : []),
                ]);
              return (
                <li key={weekday} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 py-1.5">
                  <label className="flex w-32 items-center gap-2 text-sm">
                    <WaSwitch checked={!!range} onCheckedChange={(v) => update(v ? {} : null)} aria-label={name} />
                    {name}
                  </label>
                  {range ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        aria-label={`${name} desde`}
                        value={range.from}
                        onChange={(e) => update({ from: e.target.value })}
                        className="w-32"
                      />
                      <span className="text-xs text-muted-foreground">a</span>
                      <Input
                        type="time"
                        aria-label={`${name} hasta`}
                        value={range.to}
                        onChange={(e) => update({ to: e.target.value })}
                        className="w-32"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">No agenda</span>
                  )}
                </li>
              );
            })}
          </ul>
        </SettingRow>
        <SettingRow
          id="wa-booking-buffer"
          layout="row"
          label="Respiro entre citas"
          help="Minutos libres antes y después de cada cita."
          state={states["wa-booking-buffer"]}
        >
          <NumberField
            min={0}
            max={120}
            suffix="min"
            value={b.bufferMin}
            invalid={states["wa-booking-buffer"]?.status === "error"}
            onChange={(v) => change("wa-booking-buffer", "booking.bufferMin", v, TYPING_DELAY)}
          />
        </SettingRow>
        <SettingRow
          id="wa-booking-notice"
          layout="row"
          label="Antelación mínima"
          help="No ofrece horas más cerca que esto."
          state={states["wa-booking-notice"]}
        >
          <NumberField
            min={0}
            max={168}
            suffix="horas"
            value={b.minNoticeHours}
            invalid={states["wa-booking-notice"]?.status === "error"}
            onChange={(v) => change("wa-booking-notice", "booking.minNoticeHours", v, TYPING_DELAY)}
          />
        </SettingRow>
        <SettingRow
          id="wa-booking-horizon"
          layout="row"
          label="Agenda hasta"
          help="Cuántos días hacia adelante ofrece horas."
          state={states["wa-booking-horizon"]}
        >
          <NumberField
            min={1}
            max={60}
            suffix="días"
            value={b.horizonDays}
            invalid={states["wa-booking-horizon"]?.status === "error"}
            onChange={(v) => change("wa-booking-horizon", "booking.horizonDays", v, TYPING_DELAY)}
          />
        </SettingRow>
        <ToggleRow
          id="wa-booking-meet"
          label="Enlace de Google Meet en cada cita"
          state={states["wa-booking-meet"]}
          checked={b.addMeet}
          onChange={(v) => change("wa-booking-meet", "booking.addMeet", v)}
        />
      </SettingsGroup>
    </div>
  );
};

export default BookingTab;
