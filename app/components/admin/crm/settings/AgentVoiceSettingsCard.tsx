"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { Switch } from "@/app/components/ui/switch";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import type { AgentVoiceSettings, CallProviderId } from "@/lib/voice/settings-rules";

export type CallProviderStatus = { id: Exclude<CallProviderId, "off">; missing: string[] };

const CALL_LABEL: Record<CallProviderId, string> = {
  off: "Apagadas",
  fake: "Simuladas (prueba, no suena nada)",
  twilio: "Llamada normal (Twilio)",
  whatsapp: "Llamada de WhatsApp (segundo número)",
};

type Props = { initial: AgentVoiceSettings; providers: CallProviderStatus[] };

/**
 * La voz del asistente fuera del panel: notas de voz a su WhatsApp personal y
 * llamadas a su celular. Todo apagado hasta que la dueña lo enciende; las
 * claves no se escriben aquí (van en Vercel), solo se dice cuáles faltan.
 */
const AgentVoiceSettingsCard = ({ initial, providers: initialProviders }: Props) => {
  const { toast } = useCrm();
  const [settings, setSettings] = useState(initial);
  const [providers, setProviders] = useState(initialProviders);
  const [phone, setPhone] = useState(initial.ownerPhone ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  const save = async (patch: Partial<AgentVoiceSettings>, key: string) => {
    setBusy(key);
    try {
      const res = await fetch("/api/admin/settings/agent-voice", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => ({}))) as { settings?: AgentVoiceSettings; providers?: CallProviderStatus[]; error?: string };
      if (!res.ok || !data.settings) {
        toast(data.error ?? "No se pudo guardar.", "error");
        return false;
      }
      setSettings(data.settings);
      if (data.providers) setProviders(data.providers);
      setPhone(data.settings.ownerPhone ?? "");
      toast("Guardado.");
      return true;
    } catch {
      toast("No se pudo contactar con el servidor.", "error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const test = async (action: "test_voice_note" | "test_call") => {
    setBusy(action);
    try {
      const res = await fetch("/api/admin/settings/agent-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; simulated?: boolean; dryRun?: boolean };
      if (!data.ok) toast(data.error ?? "No se pudo.", "error");
      else if (action === "test_call") toast(data.simulated ? "Llamada simulada registrada (no sonó ningún teléfono)." : "Llamando a tu celular…");
      else toast(data.dryRun ? "Nota generada en modo prueba (no salió a WhatsApp)." : "Nota de voz enviada a tu WhatsApp.");
    } catch {
      toast("No se pudo contactar con el servidor.", "error");
    } finally {
      setBusy(null);
    }
  };

  const callMissing = settings.calls === "off" ? [] : (providers.find((p) => p.id === settings.calls)?.missing ?? []);

  return (
    <Card data-testid="agent-voice-settings">
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Voz del asistente</h3>
          <p className="text-xs text-muted-foreground">
            En el panel, el asistente ya habla y escucha con el botón «Modo voz» (gratis, lo hace el navegador). Aquí se
            enciende lo que sale del panel: notas de voz a tu WhatsApp personal y llamadas a tu celular.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-voice-phone">Tu número personal de WhatsApp</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="agent-voice-phone"
              inputMode="tel"
              placeholder="+57 300 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="min-w-0 flex-1 basis-48"
            />
            <Button
              variant="outline"
              disabled={busy !== null || phone.trim() === (settings.ownerPhone ?? "")}
              onClick={() => void save({ ownerPhone: phone.trim() || null }, "phone")}
            >
              Guardar número
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            No el número de la empresa: desde ese sale todo. WhatsApp solo deja mandarle una nota si le escribiste a la
            empresa desde este número en las últimas 24 h.
          </p>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm">Notas de voz por WhatsApp</p>
            <p className="text-xs text-muted-foreground">Cuando le pides «mándamelo en un audio».</p>
          </div>
          <Switch
            aria-label="Notas de voz por WhatsApp"
            checked={settings.voiceNotes}
            disabled={busy !== null}
            onCheckedChange={(next) => void save({ voiceNotes: Boolean(next) }, "voiceNotes")}
          />
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm">Sus avisos también como nota de voz</p>
            <p className="text-xs text-muted-foreground">
              Lo que el asistente te escribe por su cuenta (la campana) te llega además leído, de {settings.quietStartHour}:00 a{" "}
              {settings.quietEndHour}:00.
            </p>
          </div>
          <Switch
            aria-label="Avisos como nota de voz"
            checked={settings.voiceNotesProactive}
            disabled={busy !== null || !settings.voiceNotes}
            onCheckedChange={(next) => void save({ voiceNotesProactive: Boolean(next) }, "proactive")}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Llamadas a tu celular</Label>
          <Select
            value={settings.calls}
            onValueChange={(value) => void save({ calls: (typeof value === "string" ? value : "off") as CallProviderId }, "calls")}
          >
            <SelectTrigger aria-label="Llamadas a tu celular" disabled={busy !== null}>
              <SelectValue>{(value) => CALL_LABEL[value as CallProviderId] ?? String(value)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CALL_LABEL) as CallProviderId[]).map((id) => (
                <SelectItem key={id} value={id}>
                  {CALL_LABEL[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {callMissing.length > 0 && (
            <p className="text-xs text-destructive">
              Falta configurar en Vercel: {callMissing.join(", ")}. Hasta entonces el asistente no puede llamar.
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || !settings.ownerPhone}
            onClick={() => void test("test_voice_note")}
          >
            Probar nota de voz
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || !settings.ownerPhone || settings.calls === "off"}
            onClick={() => void test("test_call")}
          >
            Probar llamada
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default AgentVoiceSettingsCard;
