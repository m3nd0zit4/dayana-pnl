"use client";

import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/app/components/ui/alert";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import IntegrationHealthList from "./IntegrationHealthList";
import type { IntegrationHealth } from "@/lib/notifications/health";

type Props = {
  initialIntegrations: IntegrationHealth[];
  runtime: { enabled: boolean; dryRun: boolean; emailProvider: string | null };
  defaultTestEmail: string;
};

type TestResult =
  | { kind: "ok"; message: string; dryRun: boolean }
  | { kind: "error"; message: string };

const IntegrationsHealthClient = ({
  initialIntegrations,
  runtime,
  defaultTestEmail,
}: Props) => {
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [refreshing, setRefreshing] = useState(false);
  const [to, setTo] = useState(defaultTestEmail);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const email = integrations.find((i) => i.id === "email");

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/settings/health");
      if (res.ok) {
        const data = (await res.json()) as { integrations?: IntegrationHealth[] };
        if (data.integrations) setIntegrations(data.integrations);
      }
    } catch {
      /* Si falla el refresco se conserva lo que ya se estaba mostrando. */
    } finally {
      setRefreshing(false);
    }
  };

  const sendTest = async () => {
    setResult(null);
    setSending(true);

    try {
      const res = await fetch("/api/admin/notifications/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(to.trim() ? { to: to.trim() } : {}),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        to?: string;
        providerId?: string;
        dryRun?: boolean;
        error?: string;
        detail?: string;
      };

      if (!res.ok) {
        setResult({
          kind: "error",
          message:
            data.error === "invalid_email"
              ? "Ese correo no es válido."
              : data.detail ?? "No se pudo enviar el correo de prueba.",
        });
        return;
      }

      // Lo importante del panel: decir sin rodeos que en modo simulado no
      // salió nada. Un "enviado" a secas aquí sería mentira.
      setResult({
        kind: "ok",
        dryRun: Boolean(data.dryRun),
        message: data.dryRun
          ? `Se envió en modo simulado (DRY RUN) — no salió ningún correo real a ${data.to}.`
          : `Correo enviado a ${data.to} vía ${data.providerId}.`,
      });
    } catch {
      setResult({
        kind: "error",
        message: "No se pudo enviar. Revisa tu conexión.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {runtime.dryRun && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Modo simulado activo</AlertTitle>
          <AlertDescription>
            <code>NOTIFICATIONS_DRY_RUN</code> está encendido: los correos, SMS
            y WhatsApp se registran como enviados pero <strong>no salen</strong>.
            Fuera de producción viene así por defecto.
          </AlertDescription>
        </Alert>
      )}

      {!runtime.enabled && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Envíos apagados</AlertTitle>
          <AlertDescription>
            <code>NOTIFICATIONS_ENABLED</code> no es <code>true</code>: la
            plataforma no despacha notificaciones salientes.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Integraciones
              </h2>
              <p className="text-sm text-muted-foreground">
                Estado según las variables de entorno. No se consulta a los
                proveedores: esto dice si las llaves están puestas, no si el
                servicio responde.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={refresh}
            >
              <RefreshCw className={refreshing ? "animate-spin" : undefined} />
              {refreshing ? "Actualizando…" : "Actualizar"}
            </Button>
          </div>

          <IntegrationHealthList items={integrations} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Correo de prueba
            </h2>
            <p className="text-sm text-muted-foreground">
              Envía un correo de diagnóstico y queda registrado en el registro
              de envíos. Vacío = a tu propio correo.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 space-y-2 sm:max-w-sm">
              <Label htmlFor="test-email-to">Destinatario</Label>
              <Input
                id="test-email-to"
                type="email"
                value={to}
                disabled={sending}
                placeholder={defaultTestEmail}
                onChange={(e) => {
                  setResult(null);
                  setTo(e.target.value);
                }}
              />
            </div>
            <Button
              type="button"
              disabled={sending || (email ? !email.canTest : false)}
              onClick={sendTest}
            >
              {sending ? "Enviando…" : "Enviar correo de prueba"}
            </Button>
          </div>

          {email && !email.canTest && (
            <p className="text-sm text-muted-foreground">
              No hay proveedor de correo configurado, así que la prueba no
              puede correr.
            </p>
          )}

          {result?.kind === "error" && (
            <Alert>
              <TriangleAlert />
              <AlertTitle>No se pudo enviar</AlertTitle>
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>
          )}

          {result?.kind === "ok" && (
            <Alert>
              {result.dryRun ? <TriangleAlert /> : <CheckCircle2 />}
              <AlertTitle>
                {result.dryRun ? "Simulado, no enviado" : "Enviado"}
              </AlertTitle>
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default IntegrationsHealthClient;
