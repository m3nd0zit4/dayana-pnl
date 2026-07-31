"use client";

import { useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Card, CardContent } from "@/app/components/ui/card";
import { Switch } from "@/app/components/ui/switch";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";

export type AgentChannelSummary = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  agentEnabled: boolean;
  allowLocalDevAuth: boolean;
};

type Props = {
  channels: AgentChannelSummary[];
  /** Estado efectivo ya fusionado (override de BD, o `CRM_AGENT_ENABLED` si no hay fila). */
  globalEnabled: boolean;
  /** Fila cruda: `null` = automático (usa el entorno). */
  globalOverride: boolean | null;
};

const AgentChannelsClient = ({ channels, globalEnabled, globalOverride }: Props) => {
  const { toast } = useCrm();
  const [items, setItems] = useState(channels);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [globalBusy, setGlobalBusy] = useState(false);
  const [effectiveEnabled, setEffectiveEnabled] = useState(globalEnabled);
  const [override, setOverride] = useState(globalOverride);

  const toggle = async (channel: AgentChannelSummary, next: boolean) => {
    setBusyId(channel.id);
    try {
      const res = await fetch(`/api/admin/settings/channels/${channel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        toast("No se pudo actualizar el canal.", "error");
        return;
      }
      setItems((prev) =>
        prev.map((c) => (c.id === channel.id ? { ...c, enabled: next } : c))
      );
      toast(next ? "Canal habilitado." : "Canal deshabilitado.");
    } catch {
      toast("No se pudo contactar con el servidor.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const setGlobal = async (value: boolean | null) => {
    setGlobalBusy(true);
    try {
      const res = await fetch("/api/admin/settings/agent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: value }),
      });
      if (!res.ok) {
        toast("No se pudo actualizar el asistente.", "error");
        return;
      }
      const effective = value ?? globalEnabled;
      setOverride(value);
      setEffectiveEnabled(value == null ? globalEnabled : value);
      setItems((prev) => prev.map((c) => ({ ...c, agentEnabled: effective })));
      toast(
        value == null
          ? "Vuelto a automático (entorno)."
          : value
            ? "Asistente activado globalmente."
            : "Asistente desactivado globalmente."
      );
    } catch {
      toast("No se pudo contactar con el servidor.", "error");
    } finally {
      setGlobalBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          Canales del agente
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Por dónde se puede llegar al asistente. Apagar un canal que ya
          existe es inmediato; añadir uno nuevo (Slack, WhatsApp, Discord…)
          sigue necesitando su propio archivo en{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            agent/channels/
          </code>{" "}
          y un despliegue — eso no depende de esta pantalla.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-medium">
                Asistente activado globalmente
              </h3>
              <p className="text-xs text-muted-foreground">
                Interruptor maestro por encima de los canales. Apagado aquí,
                ningún canal responde aunque esté habilitado individualmente.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant={override == null ? "secondary" : "default"}>
                {override == null ? "Automático (entorno)" : "Override manual"}
              </Badge>
              <Switch
                checked={effectiveEnabled}
                disabled={globalBusy}
                onCheckedChange={(next) => void setGlobal(Boolean(next))}
              />
            </div>
          </div>

          {override != null && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
              disabled={globalBusy}
              onClick={() => void setGlobal(null)}
            >
              Restablecer a automático
            </button>
          )}
        </CardContent>
      </Card>

      {items.map((channel) => (
        <Card key={channel.id}>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-medium">{channel.label}</h3>
                <p className="text-xs text-muted-foreground">
                  {channel.description}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={channel.agentEnabled ? "default" : "secondary"}>
                  {channel.agentEnabled
                    ? "Asistente activo"
                    : "Asistente apagado"}
                </Badge>
                <Switch
                  checked={channel.enabled}
                  disabled={busyId === channel.id}
                  onCheckedChange={(next) => void toggle(channel, Boolean(next))}
                />
              </div>
            </div>

            {!channel.agentEnabled && (
              <p className="text-xs text-muted-foreground">
                El asistente está apagado globalmente (
                <code>CRM_AGENT_ENABLED</code>); este interruptor no importa
                hasta que se encienda.
              </p>
            )}

            {channel.allowLocalDevAuth && (
              <p className="text-xs text-muted-foreground">
                <code>CRM_AGENT_LOCAL_DEV_AUTH</code> está activo: en
                desarrollo local también entra sin sesión de staff.
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default AgentChannelsClient;
