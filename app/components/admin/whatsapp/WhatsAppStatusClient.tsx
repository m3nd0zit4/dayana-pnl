"use client";

import InboxHealthCard from "./InboxHealthCard";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import CrmPageShell from "../crm/CrmPageShell";
import { useWhatsAppLive } from "./live";
import PushToggle from "./PushToggle";
import { RunStatus, agoLabel, useNow } from "./status";
import type { RunView } from "@/lib/crm/whatsapp-agent/workspace";

type Overview = {
  enabled: boolean;
  kpis: {
    replied: number;
    drafted: number;
    escalated: number;
    errors: number;
    skipped: number;
    bookings: number;
    avgLatencyMs: number | null;
  };
  health: {
    provider: string;
    providerConnected: boolean;
    webhookRegistered: boolean;
    lastInboundAt: string | null;
    modelKey: boolean;
    calendarAccounts: number;
    bookingEnabled: boolean;
    pushConfigured: boolean;
    pushDevices: number;
  };
  runs: (RunView & { conversationId: string; name: string })[];
};

const Kpi = ({ label, value, tone }: { label: string; value: string | number; tone?: string }) => (
  <div className="rounded-xl border border-border bg-card p-3">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className={`text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
  </div>
);

const Check = ({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) => (
  <li className="flex items-start gap-2 text-sm">
    {ok ? (
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
    ) : (
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-[#667781]" />
    )}
    <span>
      {label}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </span>
  </li>
);

/** Qué hizo la IA en las últimas 24 h y si todo lo que necesita está conectado. */
const WhatsAppStatusClient = () => {
  const [data, setData] = useState<Overview | null>(null);
  const now = useNow(true, 30_000);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/whatsapp/overview", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setData((await res.json()) as Overview);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useWhatsAppLive(load);

  if (!data) {
    return (
      <CrmPageShell>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </CrmPageShell>
    );
  }
  const { kpis, health } = data;

  return (
    <CrmPageShell>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Estado de la IA</h1>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${data.enabled ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}
        >
          {data.enabled ? "Encendida" : "Apagada"}
        </span>
        <span className="text-xs text-muted-foreground">Últimas 24 horas · se actualiza sola</span>
      </div>

      <InboxHealthCard />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Kpi label="Respondió sola" value={kpis.replied} tone="text-emerald-700" />
        <Kpi label="Borradores" value={kpis.drafted} tone="text-violet-700" />
        <Kpi label="Te pasó a ti" value={kpis.escalated} tone="text-[#008069]" />
        <Kpi label="Citas agendadas" value={kpis.bookings} tone="text-sky-700" />
        <Kpi label="No respondió" value={kpis.skipped} />
        <Kpi label="Fallas" value={kpis.errors} tone={kpis.errors ? "text-red-700" : ""} />
        <Kpi
          label="Tiempo medio"
          value={kpis.avgLatencyMs ? `${Math.round(kpis.avgLatencyMs / 1000)} s` : "—"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <section className="rounded-xl border border-border bg-card">
          <h2 className="border-b border-border px-3 py-2 text-sm font-semibold">Lo último que hizo</h2>
          <ul className="divide-y divide-border/60">
            {data.runs.length === 0 && (
              <li className="p-4 text-sm text-muted-foreground">Todavía no ha pasado nada.</li>
            )}
            {data.runs.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/whatsapp?conversation=${r.conversationId}`}
                  className="flex flex-col gap-0.5 px-3 py-2 hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-3"
                >
                  <span className="w-40 shrink-0 truncate text-sm font-medium">{r.name}</span>
                  <RunStatus run={r} className="min-w-0 flex-1" />
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {agoLabel(r.queuedAt, now)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-3">
            <h2 className="mb-2 text-sm font-semibold">¿Está todo conectado?</h2>
            <ul className="space-y-2">
              <Check
                ok={data.enabled}
                label="IA encendida"
                hint={data.enabled ? undefined : "Enciéndela en Ajustes."}
              />
              <Check
                ok={health.providerConnected}
                label={`WhatsApp conectado (${health.provider === "dialog360" ? "360dialog" : "Meta"})`}
              />
              <Check
                ok={health.webhookRegistered}
                label="Mensajes entrantes conectados"
                hint={health.webhookRegistered ? undefined : "Ajustes → «Conectar mensajes entrantes»."}
              />
              <Check
                ok={Boolean(health.lastInboundAt)}
                label="Último mensaje recibido"
                hint={
                  health.lastInboundAt
                    ? agoLabel(health.lastInboundAt, now)
                    : "Aún no ha llegado ninguno."
                }
              />
              <Check ok={health.modelKey} label="Modelo de IA (Gemini)" />
              <Check
                ok={!health.bookingEnabled || health.calendarAccounts > 0}
                label="Google Calendar para agendar"
                hint={
                  health.bookingEnabled
                    ? health.calendarAccounts
                      ? undefined
                      : "Conecta Google Calendar en Ajustes → Integraciones."
                    : "Agendar está apagado."
                }
              />
              <Check
                ok={health.pushConfigured && health.pushDevices > 0}
                label="Avisos al teléfono"
                hint={
                  !health.pushConfigured
                    ? "Faltan las claves de push en Vercel."
                    : health.pushDevices
                      ? `${health.pushDevices} dispositivo(s)`
                      : "Actívalos en este teléfono con el botón de abajo."
                }
              />
            </ul>
          </section>
          <PushToggle />
        </div>
      </div>
    </CrmPageShell>
  );
};

export default WhatsAppStatusClient;
