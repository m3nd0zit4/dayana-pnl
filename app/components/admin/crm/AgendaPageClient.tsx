"use client";

import { CalendarClock, ExternalLink, Video } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Switch } from "@/app/components/ui/switch";
import { Textarea } from "@/app/components/ui/textarea";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import { useCrm } from "./CrmProvider";
import {
  CrmPublicLink,
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmField,
  CrmRowActions,
  CrmRowDelete,
} from "./ui";

export type BookingRule = { weekday: number; from: string; to: string };

export type BookingConfigDto = {
  isActive: boolean;
  title: string;
  description: string | null;
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  horizonDays: number;
  rules: BookingRule[];
};

export type AppointmentRow = {
  id: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  name: string;
  email: string;
  phone: string | null;
  note: string | null;
  meetUrl: string | null;
  status: "BOOKED" | "CANCELLED";
  contactId: string;
};

const WEEKDAYS = [
  { id: 1, label: "Lun" },
  { id: 2, label: "Mar" },
  { id: 3, label: "Mié" },
  { id: 4, label: "Jue" },
  { id: 5, label: "Vie" },
  { id: 6, label: "Sáb" },
  { id: 0, label: "Dom" },
];

const when = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date(iso));

/**
 * La agenda desde el panel: cuándo se puede reservar y quién reservó.
 *
 * Los huecos no se editan aquí uno a uno — se define el horario y el resto lo
 * decide el Google Calendar de Dayana en cada carga de la página pública. Un
 * calendario de huecos editable a mano se desincroniza el primer día que ella
 * apunte algo desde el teléfono.
 */
const AgendaPageClient = ({
  preview,
  initialConfig,
  initialAppointments,
  siteUrl,
  calendarConnected,
}: {
  preview: boolean;
  initialConfig: BookingConfigDto;
  initialAppointments: AppointmentRow[];
  siteUrl: string;
  calendarConnected: boolean;
}) => {
  const { canManageTeam, toast, confirm } = useCrm();
  const [config, setConfig] = useState(initialConfig);
  const [appointments, setAppointments] = useState(initialAppointments);
  const [saving, setSaving] = useState(false);

  const editable = canManageTeam && !preview;

  const save = async (next: BookingConfigDto) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/booking", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast(
          data.error === "invalid_range"
            ? "Una franja termina antes de empezar."
            : "No se pudo guardar.",
          "error"
        );
        return;
      }
      setConfig(next);
      toast("Agenda actualizada", "success");
    } finally {
      setSaving(false);
    }
  };

  const toggleDay = (weekday: number) => {
    const has = config.rules.some((r) => r.weekday === weekday);
    const rules = has
      ? config.rules.filter((r) => r.weekday !== weekday)
      : [...config.rules, { weekday, from: "09:00", to: "18:00" }];
    setConfig((c) => ({ ...c, rules }));
  };

  const setRule = (weekday: number, field: "from" | "to", value: string) => {
    setConfig((c) => ({
      ...c,
      rules: c.rules.map((r) => (r.weekday === weekday ? { ...r, [field]: value } : r)),
    }));
  };

  const cancel = (row: AppointmentRow) => {
    confirm({
      title: "Cancelar la cita",
      message: `Se libera el hueco de ${row.name} y se borra el evento del calendario. Ella no recibe aviso automático.`,
      confirmLabel: "Cancelar la cita",
      destructive: true,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/booking/${row.id}`, { method: "DELETE" });
        if (!res.ok) {
          toast("No se pudo cancelar", "error");
          return;
        }
        setAppointments((prev) =>
          prev.map((a) => (a.id === row.id ? { ...a, status: "CANCELLED" } : a))
        );
        toast("Cita cancelada", "success");
      },
    });
  };

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Agenda"
        description="Tus horas libres salen de tu Google Calendar; aquí solo defines cuándo se puede reservar."
        secondaryActions={
          config.isActive ? <CrmPublicLink href="/agenda" label="Ver la agenda" /> : undefined
        }
      />

      {!calendarConnected && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            No hay ninguna cuenta de Google con Calendario conectada, así que
            los huecos no se cruzan con tu calendario real y una cita no crea
            evento ni Meet. Se conecta en Ajustes → Google.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-5 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">Agenda abierta</p>
              <p className="text-sm text-muted-foreground">
                Apagada, {siteUrl}/agenda responde 404.
              </p>
            </div>
            <Switch
              checked={config.isActive}
              disabled={!editable || saving}
              onCheckedChange={(next) => void save({ ...config, isActive: next })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ag-title">Título</Label>
              <Input
                id="ag-title"
                value={config.title}
                disabled={!editable}
                onChange={(e) => setConfig((c) => ({ ...c, title: e.target.value }))}
              />
            </div>
            <CrmField label="Duración (minutos)">
              <Input
                type="number"
                min={10}
                max={240}
                value={config.durationMinutes}
                disabled={!editable}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, durationMinutes: Number(e.target.value) }))
                }
              />
            </CrmField>
            <CrmField
              label="Margen entre citas (minutos)"
              description="Respiro antes y después de cada cita."
            >
              <Input
                type="number"
                min={0}
                max={120}
                value={config.bufferMinutes}
                disabled={!editable}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, bufferMinutes: Number(e.target.value) }))
                }
              />
            </CrmField>
            <CrmField
              label="Antelación mínima (horas)"
              description="Nadie puede reservar para dentro de un rato."
            >
              <Input
                type="number"
                min={0}
                max={168}
                value={config.minNoticeHours}
                disabled={!editable}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, minNoticeHours: Number(e.target.value) }))
                }
              />
            </CrmField>
            <CrmField label="Días visibles hacia adelante">
              <Input
                type="number"
                min={1}
                max={60}
                value={config.horizonDays}
                disabled={!editable}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, horizonDays: Number(e.target.value) }))
                }
              />
            </CrmField>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ag-desc">Descripción</Label>
            <Textarea
              id="ag-desc"
              rows={2}
              value={config.description ?? ""}
              disabled={!editable}
              onChange={(e) =>
                setConfig((c) => ({ ...c, description: e.target.value || null }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label>Días y horas en que atiendes</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => {
                const on = config.rules.some((r) => r.weekday === d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={!editable}
                    onClick={() => toggleDay(d.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      on
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground hover:border-foreground/40"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>

            <div className="space-y-2 pt-1">
              {WEEKDAYS.filter((d) => config.rules.some((r) => r.weekday === d.id)).map(
                (d) => {
                  const rule = config.rules.find((r) => r.weekday === d.id)!;
                  return (
                    <div key={d.id} className="flex items-center gap-2 text-sm">
                      <span className="w-10 text-muted-foreground">{d.label}</span>
                      <Input
                        type="time"
                        className="w-32"
                        value={rule.from}
                        disabled={!editable}
                        onChange={(e) => setRule(d.id, "from", e.target.value)}
                      />
                      <span className="text-muted-foreground">a</span>
                      <Input
                        type="time"
                        className="w-32"
                        value={rule.to}
                        disabled={!editable}
                        onChange={(e) => setRule(d.id, "to", e.target.value)}
                      />
                    </div>
                  );
                }
              )}
            </div>
          </div>

          {editable && (
            <div className="flex justify-end">
              <Button onClick={() => void save(config)} disabled={saving}>
                {saving ? "Guardando…" : "Guardar horario"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {appointments.length === 0 ? (
        <CrmEmptyState
          icon={CalendarClock}
          title="Todavía no hay citas"
          description="Comparte el enlace de tu agenda en WhatsApp, en la bio o al responder un comentario."
        />
      ) : (
        <CrmDataList>
          {appointments.map((a) => (
            <CrmDataListRow
              key={a.id}
              actions={
                editable && a.status === "BOOKED" ? (
                  <CrmRowActions>
                    <CrmRowDelete label="Cancelar" onClick={() => cancel(a)} />
                  </CrmRowActions>
                ) : undefined
              }
            >
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate font-medium">{a.name}</p>
                <p className="truncate text-xs text-muted-foreground">{a.email}</p>
                {a.note && (
                  <p className="truncate text-xs text-muted-foreground" title={a.note}>
                    {a.note}
                  </p>
                )}
              </div>

              <div className="sm:w-52">
                <p className="text-sm">{when(a.startsAt, a.timezone)}</p>
                {a.meetUrl && (
                  <a
                    href={a.meetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2"
                  >
                    <Video className="size-3" aria-hidden />
                    Videollamada
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </div>

              <div className="sm:w-28">
                {a.status === "BOOKED" ? (
                  <Badge className="border-success/40 bg-success/10 text-success">
                    Confirmada
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Cancelada
                  </Badge>
                )}
              </div>
            </CrmDataListRow>
          ))}
        </CrmDataList>
      )}
    </CrmPageShell>
  );
};

export default AgendaPageClient;
