"use client";

import { useState } from "react";

import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Switch } from "@/app/components/ui/switch";
import { Textarea } from "@/app/components/ui/textarea";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";

export type WelcomeConfigDto = {
  isActive: boolean;
  text: string;
  buttonLabel: string;
  buttonUrl: string;
};

const ERRORS: Record<string, string> = {
  invalid_url: "El enlace del botón tiene que empezar por https://.",
  incomplete_button: "Pon la etiqueta y el enlace del botón, o deja los dos vacíos.",
  invalid_body: "Revisa el texto: entre 5 y 900 caracteres.",
};

/**
 * El primer mensaje que recibe quien escribe por WhatsApp por primera vez.
 *
 * Separado de la respuesta automática a propósito: esto no lo escribe el
 * modelo, lo escribe Dayana, y se envía tal cual. El botón abre su página de
 * citas de Google Calendar dentro de WhatsApp, sin copiar enlaces.
 */
const WhatsAppWelcomeCard = ({
  initial,
  configured,
}: {
  initial: WelcomeConfigDto;
  configured: boolean;
}) => {
  const { toast } = useCrm();
  const [config, setConfig] = useState(initial);
  const [saving, setSaving] = useState(false);

  const save = async (next: WelcomeConfigDto) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/whatsapp-welcome", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast(ERRORS[data.error ?? ""] ?? "No se pudo guardar.", "error");
        return;
      }
      setConfig(next);
      toast("Saludo actualizado", "success");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium">Saludo a quien escribe por primera vez</p>
            <p className="text-sm text-muted-foreground">
              {configured
                ? "Solo en el primer mensaje de cada persona. Quien ya te escribió antes no lo recibe otra vez."
                : "Falta conectar WhatsApp: sin credenciales no se envía nada aunque lo enciendas."}
            </p>
          </div>
          <Switch
            checked={config.isActive}
            disabled={saving}
            onCheckedChange={(next) => void save({ ...config, isActive: next })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wa-welcome-text">Mensaje</Label>
          <Textarea
            id="wa-welcome-text"
            rows={3}
            value={config.text}
            onChange={(e) => setConfig((c) => ({ ...c, text: e.target.value }))}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wa-welcome-label">Texto del botón</Label>
            <Input
              id="wa-welcome-label"
              maxLength={20}
              value={config.buttonLabel}
              onChange={(e) =>
                setConfig((c) => ({ ...c, buttonLabel: e.target.value }))
              }
              placeholder="Agendar mi cita"
            />
            <p className="text-[11px] text-muted-foreground">
              WhatsApp corta en 20 caracteres.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wa-welcome-url">A dónde lleva</Label>
            <Input
              id="wa-welcome-url"
              value={config.buttonUrl}
              onChange={(e) =>
                setConfig((c) => ({ ...c, buttonUrl: e.target.value }))
              }
              placeholder="https://calendar.app.google/tu-enlace"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void save(config)} disabled={saving}>
            {saving ? "Guardando…" : "Guardar saludo"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default WhatsAppWelcomeCard;
