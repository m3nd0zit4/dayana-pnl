"use client";

import { useState } from "react";

import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";

export type WhatsAppProviderSummaryDto = {
  provider: "meta" | "dialog360";
  hasApiKey: boolean;
  apiKeyFingerprint: string | null;
  webhookRegistered: boolean;
  metaEnvConfigured: boolean;
};

const PROVIDERS = [
  {
    id: "dialog360" as const,
    label: "360dialog (coexistencia)",
    hint: "Tu número sigue en la app del celular y a la vez lo atiende el CRM. Es la opción para usar un solo número.",
  },
  {
    id: "meta" as const,
    label: "Meta directo",
    hint: "El número pasa entero a la API y deja de funcionar en la app del celular. Solo para un número dedicado.",
  },
];

/**
 * Proveedor de WhatsApp, elegido y conectado desde el CRM.
 *
 * La clave se escribe y no se vuelve a ver: el panel solo enseña su huella
 * (8 caracteres) para saber cuál está puesta. Conectar es un botón: el CRM
 * registra su propia URL de avisos en 360dialog con un secreto nuevo.
 */
const WhatsAppProviderCard = ({
  initial,
}: {
  initial: WhatsAppProviderSummaryDto;
}) => {
  const { toast } = useCrm();
  const [summary, setSummary] = useState(initial);
  const [provider, setProvider] = useState(initial.provider);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<null | "save" | "test" | "webhook">(null);

  const save = async () => {
    setBusy("save");
    try {
      const res = await fetch("/api/admin/settings/whatsapp-provider", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: apiKey.trim() || null }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        summary?: WhatsAppProviderSummaryDto;
      };
      if (!res.ok || !data.summary) {
        toast("No se pudo guardar.", "error");
        return;
      }
      setSummary(data.summary);
      setApiKey("");
      toast("Proveedor guardado", "success");
    } finally {
      setBusy(null);
    }
  };

  const run = async (action: "test" | "register-webhook") => {
    setBusy(action === "test" ? "test" : "webhook");
    try {
      const res = await fetch("/api/admin/settings/whatsapp-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        webhookUrl?: string | null;
      };
      if (!res.ok) {
        toast(data.message ?? "360dialog no respondió.", "error");
        return;
      }
      if (action === "test") {
        toast("La clave funciona con 360dialog.", "success");
      } else {
        setSummary((s) => ({ ...s, webhookRegistered: true }));
        toast("Conectado: los mensajes llegarán a la bandeja.", "success");
      }
    } finally {
      setBusy(null);
    }
  };

  const isDialog = provider === "dialog360";
  const savedIsDialog = summary.provider === "dialog360";

  return (
    <Card>
      <CardContent className="space-y-5 py-5">
        <div>
          <p className="font-medium">Proveedor de WhatsApp</p>
          <p className="text-sm text-muted-foreground">
            Por dónde entran y salen los mensajes de WhatsApp del CRM.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setProvider(p.id)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                provider === p.id
                  ? "border-foreground bg-muted/60"
                  : "border-border hover:border-foreground/40"
              }`}
            >
              <p className="text-sm font-medium">{p.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{p.hint}</p>
            </button>
          ))}
        </div>

        {isDialog ? (
          <div className="space-y-1.5">
            <Label htmlFor="wa-360-key">Clave de API de 360dialog</Label>
            <Input
              id="wa-360-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                summary.hasApiKey
                  ? `Guardada (huella ${summary.apiKeyFingerprint}). Escribe otra para reemplazarla.`
                  : "Pégala desde el panel de 360dialog"
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Se guarda cifrada y no se vuelve a mostrar.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {summary.metaEnvConfigured
              ? "Usa las credenciales de Meta del servidor."
              : "No hay credenciales de Meta en el servidor."}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={busy !== null}>
            {busy === "save" ? "Guardando…" : "Guardar"}
          </Button>

          {savedIsDialog && summary.hasApiKey && (
            <>
              <Button
                variant="outline"
                onClick={() => void run("test")}
                disabled={busy !== null}
              >
                {busy === "test" ? "Probando…" : "Probar conexión"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void run("register-webhook")}
                disabled={busy !== null}
              >
                {busy === "webhook"
                  ? "Conectando…"
                  : summary.webhookRegistered
                    ? "Volver a conectar"
                    : "Conectar mensajes entrantes"}
              </Button>

            </>
          )}

          {savedIsDialog && summary.webhookRegistered && (
            <Badge className="border-success/40 bg-success/10 text-success">
              Recibiendo mensajes
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default WhatsAppProviderCard;
