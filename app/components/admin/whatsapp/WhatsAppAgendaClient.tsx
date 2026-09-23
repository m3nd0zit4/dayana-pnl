"use client";

import { Loader2, Plus, Trash2, Video } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Switch } from "@/app/components/ui/switch";
import type { WhatsAppBookingConfig } from "@/lib/crm/whatsapp-ai-config";
import CrmPageShell from "../crm/CrmPageShell";
import { useCrm } from "../crm/CrmProvider";
import GoogleCalendarView from "./GoogleCalendarView";
import { useNow } from "./status";

export type BookingRow = {
  id: string;
  conversationId: string;
  name: string | null;
  phone: string;
  service: string;
  startsAt: string;
  meetUrl: string | null;
  status: string;
};

const BookingList = ({ rows }: { rows: BookingRow[] }) => (
  <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card">
    {rows.map((b) => (
      <li key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span className="w-52 shrink-0 font-medium capitalize">
          {new Date(b.startsAt).toLocaleString("es-CO", {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {b.service} — {b.name ?? `+${b.phone}`}
        </span>
        {b.meetUrl && (
          <a href={b.meetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-700 underline">
            <Video className="size-3.5" /> Meet
          </a>
        )}
        <Link href={`/admin/whatsapp?conversation=${b.conversationId}`} className="text-xs underline">
          Chat
        </Link>
      </li>
    ))}
  </ul>
);

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/**
 * Las citas que agenda la IA y las reglas con que las agenda: qué servicios,
 * cuánto dura cada uno, en qué horario, con cuánto respiro y antelación.
 */
const WhatsAppAgendaClient = ({
  initialBooking,
  bookings,
  canEdit,
  calendarAccounts,
}: {
  initialBooking: WhatsAppBookingConfig;
  bookings: BookingRow[];
  canEdit: boolean;
  calendarAccounts: number;
}) => {
  const { toast } = useCrm();
  const [booking, setBooking] = useState(initialBooking);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(booking) !== JSON.stringify(initialBooking);

  const set = <K extends keyof WhatsAppBookingConfig>(key: K, value: WhatsAppBookingConfig[K]) =>
    setBooking((b) => ({ ...b, [key]: value }));

  const hoursFor = (weekday: number) => booking.hours.filter((h) => h.weekday === weekday);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/whatsapp/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: { booking } }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "error");
      toast("Guardado. La IA ya agenda con estas reglas.", "success");
      window.location.reload();
    } catch (e) {
      toast(`No se pudo guardar: ${e instanceof Error ? e.message : ""}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const now = useNow(true, 60_000);
  const past = bookings.filter((b) => new Date(b.startsAt).getTime() < now - 3600_000);

  return (
    <CrmPageShell>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Agenda</h1>
        <span className="text-xs text-muted-foreground">
          Tu agenda es tu Google Calendar: la IA agenda ahí directo, sin enlaces, y confirma con la persona antes.
        </span>
      </div>

      {calendarAccounts === 0 && (
        <p className="rounded-lg border border-[#e9edef] bg-white p-3 text-sm text-[#54656f]">
          No hay Google Calendar conectado. Conéctalo en{" "}
          <Link href="/admin/ajustes/google" className="underline">
            Ajustes → Google
          </Link>{" "}
          para que la IA pueda agendar.
        </p>
      )}

      <GoogleCalendarView />

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-sm font-semibold">Cómo agenda la IA</h2>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={booking.enabled}
              onCheckedChange={(v) => set("enabled", v)}
              disabled={!canEdit}
            />
            {booking.enabled ? "Agenda sola" : "No agenda (te pasa las citas)"}
          </label>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Qué se puede agendar
          </h3>
          {booking.services.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={s.name}
                disabled={!canEdit}
                onChange={(e) =>
                  set(
                    "services",
                    booking.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))
                  )
                }
                className="max-w-xs"
              />
              <Input
                type="number"
                min={10}
                max={240}
                value={s.minutes}
                disabled={!canEdit}
                onChange={(e) =>
                  set(
                    "services",
                    booking.services.map((x, j) =>
                      j === i ? { ...x, minutes: Number(e.target.value) || 0 } : x
                    )
                  )
                }
                className="w-24"
              />
              <span className="text-xs text-muted-foreground">min</span>
              {booking.services.length > 1 && canEdit && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Quitar"
                  onClick={() => set("services", booking.services.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
          {canEdit && booking.services.length < 12 && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => set("services", [...booking.services, { name: "Nuevo servicio", minutes: 60 }])}
            >
              <Plus /> Agregar servicio
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Horario base (hora de Colombia) — solo se usa si no hay bloques «Disponible» en tu calendario
          </h3>
          {DAYS.map((label, weekday) => {
            const ranges = hoursFor(weekday);
            const on = ranges.length > 0;
            const range = ranges[0] ?? { weekday, from: "08:00", to: "18:00" };
            const update = (next: { from?: string; to?: string } | null) =>
              set("hours", [
                ...booking.hours.filter((h) => h.weekday !== weekday),
                ...(next ? [{ ...range, ...next, weekday }] : []),
              ].sort((a, b) => a.weekday - b.weekday));
            return (
              <div key={weekday} className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex w-32 items-center gap-2">
                  <Switch checked={on} disabled={!canEdit} onCheckedChange={(v) => update(v ? {} : null)} />
                  {label}
                </label>
                {on && (
                  <>
                    <Input type="time" value={range.from} disabled={!canEdit} onChange={(e) => update({ from: e.target.value })} className="w-28" />
                    <span>a</span>
                    <Input type="time" value={range.to} disabled={!canEdit} onChange={(e) => update({ to: e.target.value })} className="w-28" />
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Respiro entre citas (min)</span>
            <Input type="number" min={0} max={120} value={booking.bufferMin} disabled={!canEdit} onChange={(e) => set("bufferMin", Number(e.target.value) || 0)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Antelación mínima (horas)</span>
            <Input type="number" min={0} max={168} value={booking.minNoticeHours} disabled={!canEdit} onChange={(e) => set("minNoticeHours", Number(e.target.value) || 0)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Agenda hasta (días)</span>
            <Input type="number" min={1} max={60} value={booking.horizonDays} disabled={!canEdit} onChange={(e) => set("horizonDays", Number(e.target.value) || 1)} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={booking.addMeet} disabled={!canEdit} onCheckedChange={(v) => set("addMeet", v)} />
          Crear enlace de Google Meet en cada cita
        </label>

        {canEdit && (
          <div className="flex gap-2">
            <Button onClick={save} disabled={!dirty || saving} className="bg-[#128c4a] hover:bg-[#0f7a40]">
              {saving && <Loader2 className="animate-spin" />} Guardar
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setBooking(initialBooking)}>
                Descartar
              </Button>
            )}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Citas pasadas</h2>
          <BookingList rows={past} />
        </section>
      )}
    </CrmPageShell>
  );
};

export default WhatsAppAgendaClient;
