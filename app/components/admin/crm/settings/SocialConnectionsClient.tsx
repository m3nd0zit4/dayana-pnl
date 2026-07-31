"use client";

import {
  CheckCircle2,
  CircleSlash,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { SimpleIconGlyph, SOCIAL_PROVIDER_BRAND } from "@/lib/integrations/brand";
import type {
  ConnectedAccountView,
  SocialConnection,
  SocialConnectionStatus,
} from "@/lib/crm/social-accounts";

const STATUS_META: Record<
  SocialConnectionStatus,
  { label: string; variant: "default" | "destructive" | "secondary"; Icon: typeof CheckCircle2 }
> = {
  connected: { label: "Conectada", variant: "default", Icon: CheckCircle2 },
  needs_reconnect: {
    label: "Reconectar",
    variant: "destructive",
    Icon: TriangleAlert,
  },
  not_connected: { label: "Sin conectar", variant: "secondary", Icon: CircleSlash },
  app_not_configured: {
    label: "Sin configurar",
    variant: "secondary",
    Icon: CircleSlash,
  },
};

/**
 * Los códigos que llegan por la query se leen SOLO de este mapa. Una clave
 * desconocida da `undefined` y no pinta nada, así que un `?meta=` hostil es
 * inerte — nunca se interpola el valor recibido.
 */
const META_MESSAGE: Record<string, string> = {
  connected: "Cuenta de Meta conectada y Página suscrita a los webhooks.",
  connected_no_webhook:
    "Cuenta conectada, pero no se pudo suscribir la Página a los webhooks. Reinténtalo abajo.",
  denied: "Cancelaste la autorización en Meta.",
  no_page: "Tu cuenta de Meta no administra ninguna Página.",
  many_pages:
    "Tu cuenta administra varias Páginas. Vuelve a conectar y selecciona solo la de Dayana.",
  bad_state: "El enlace de conexión caducó. Vuelve a intentarlo.",
  invalid: "Meta no devolvió un código válido.",
  error: "No se pudo completar la conexión con Meta.",
};

const TIKTOK_MESSAGE: Record<string, string> = {
  connected: "Cuenta de TikTok conectada.",
  denied: "Cancelaste la autorización en TikTok.",
  bad_state: "El enlace de conexión caducó. Vuelve a intentarlo.",
  invalid: "TikTok no devolvió un código válido.",
  error: "No se pudo completar la conexión con TikTok.",
};

const PROVIDER_LABEL: Record<string, string> = {
  FACEBOOK: "Página de Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
};

type Props = {
  initialConnections: SocialConnection[];
  metaResult: string | null;
  tiktokResult: string | null;
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-baseline justify-between gap-2 py-3">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="text-right">{children}</dd>
  </div>
);

const ExpiryValue = ({ account }: { account: ConnectedAccountView }) => {
  if (account.expiresInDays == null) {
    return <span className="text-muted-foreground">No caduca por sí solo</span>;
  }
  if (account.expiresInDays <= 0) {
    return (
      <span className="text-destructive">
        Caducó hace {Math.abs(account.expiresInDays)} día(s)
      </span>
    );
  }
  return (
    <span className={account.expiresInDays <= 14 ? "text-destructive" : undefined}>
      Caduca en {account.expiresInDays} días
    </span>
  );
};

const SocialConnectionsClient = ({
  initialConnections,
  metaResult,
  tiktokResult,
}: Props) => {
  const [connections, setConnections] = useState(initialConnections);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    (metaResult ? META_MESSAGE[metaResult] : null) ??
      (tiktokResult ? TIKTOK_MESSAGE[tiktokResult] : null) ??
      null
  );
  const [confirming, setConfirming] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/social/connections", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { connections: SocialConnection[] };
      setConnections(data.connections);
    } catch {
      // Un fallo puntual de red deja lo último que se pintó; el botón de
      // refrescar sigue disponible.
    }
  }, []);

  const post = async (path: string, key: string, okMessage: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(path, { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          data.error === "not_connected"
            ? "No hay ninguna cuenta conectada."
            : "No se pudo completar la acción. Intenta de nuevo."
        );
      } else {
        setNotice(okMessage);
        await reload();
      }
    } catch {
      setError("No se pudo completar la acción. Revisa tu conexión.");
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  const diagnose = async () => {
    setBusy("diagnose");
    setDiagnosis(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/social/meta/diagnose", {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        app: { callbackUrl: string | null; matchesDeployment: boolean; expectedUrl: string | null } | null;
      };
      if (!data.app) {
        setDiagnosis("No se pudo consultar la app de Meta.");
      } else if (!data.app.callbackUrl) {
        setDiagnosis("La app de Meta no tiene ninguna URL de webhook registrada.");
      } else if (data.app.matchesDeployment) {
        setDiagnosis(`Correcto: la app apunta a ${data.app.callbackUrl}`);
      } else {
        setDiagnosis(
          `La app apunta a ${data.app.callbackUrl}, pero este despliegue espera ${data.app.expectedUrl}. Los mensajes están llegando a otro sitio.`
        );
      }
    } catch {
      setDiagnosis("No se pudo consultar la app de Meta.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {notice && (
        <p className="text-sm text-emerald-600" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {connections.map((connection) => {
        const meta = STATUS_META[connection.status];
        const notConfigured = connection.status === "app_not_configured";

        return (
          <Card key={connection.id}>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {connection.label}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {connection.description}
                  </p>
                </div>
                <Badge variant={meta.variant}>{meta.label}</Badge>
              </div>

              <p className="text-sm text-muted-foreground">{connection.detail}</p>

              {/* Sin registrar la app: instrucciones, no un botón muerto. */}
              {notConfigured && (
                <div className="space-y-2 rounded-md border border-dashed p-3 text-sm">
                  <p className="text-muted-foreground">
                    Define estas variables de entorno y vuelve a cargar:
                  </p>
                  <p className="flex flex-wrap gap-1">
                    {connection.requiredEnv.map((name) => (
                      <code
                        key={name}
                        className="rounded bg-muted px-1.5 py-0.5 text-xs"
                      >
                        {name}
                      </code>
                    ))}
                  </p>
                  {connection.redirectUri && (
                    <p className="text-muted-foreground">
                      Redirect URI a registrar:{" "}
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {connection.redirectUri}
                      </code>
                    </p>
                  )}
                </div>
              )}

              {connection.accounts.map((account) => (
                <div
                  key={`${account.provider}-${account.username ?? account.displayName}`}
                  className="space-y-2 rounded-md border p-3"
                >
                  <div className="flex items-center gap-3">
                    {account.avatarUrl && (
                      // <img> a propósito: la URL es del CDN del proveedor y
                      // next/image exigiría un remotePattern por dominio.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={account.avatarUrl}
                        alt=""
                        className="size-10 rounded-full border object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {account.displayName ?? account.username ?? "—"}
                      </p>
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        {/* El avatar de arriba es de la cuenta; este ícono dice
                            la plataforma — una conexión Meta trae Facebook e
                            Instagram bajo el mismo enlace y hay que distinguirlas. */}
                        <SimpleIconGlyph
                          visual={SOCIAL_PROVIDER_BRAND[account.provider]}
                          className="size-3 shrink-0"
                        />
                        {PROVIDER_LABEL[account.provider] ?? account.provider}
                        {account.username ? ` · @${account.username}` : ""}
                      </p>
                    </div>
                    {!account.isActive && (
                      <Badge variant="destructive" className="ml-auto">
                        Caída
                      </Badge>
                    )}
                  </div>

                  <dl className="divide-y divide-border text-sm">
                    <Row label="Permisos concedidos">
                      {account.scopes.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="flex flex-wrap justify-end gap-1">
                          {account.scopes.map((scope) => (
                            <code
                              key={scope}
                              className="rounded bg-muted px-1.5 py-0.5 text-xs"
                            >
                              {scope}
                            </code>
                          ))}
                        </span>
                      )}
                    </Row>
                    <Row label="Caducidad">
                      <ExpiryValue account={account} />
                    </Row>
                    <Row label="Conectada por">
                      {account.connectedByName ?? "—"}
                    </Row>
                    {account.lastError && (
                      <Row label="Último error">
                        <span className="font-mono text-xs text-destructive">
                          {account.lastError}
                        </span>
                      </Row>
                    )}
                  </dl>
                </div>
              ))}

              {connection.webhook && (
                <dl className="divide-y divide-border text-sm">
                  <Row label="Webhooks de la Página">
                    {connection.webhook.subscribed ? (
                      <span>Suscrita: {connection.webhook.fields.join(", ")}</span>
                    ) : (
                      <span className="text-destructive">Sin suscribir</span>
                    )}
                  </Row>
                </dl>
              )}

              <div className="flex flex-wrap gap-2">
                {connection.connectHref && (
                  <Button
                    size="sm"
                    variant={
                      connection.accounts.length > 0 ? "outline" : "default"
                    }
                    onClick={() => {
                      // Navegación completa: la persona tiene que aterrizar en
                      // el dominio del proveedor para autorizar.
                      window.location.href = connection.connectHref!;
                    }}
                  >
                    {connection.accounts.length > 0 ? "Reconectar" : "Conectar"}
                  </Button>
                )}

                {connection.id === "meta" &&
                  connection.webhook &&
                  !connection.webhook.subscribed && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === "subscribe"}
                      onClick={() =>
                        void post(
                          "/api/admin/social/meta/subscribe",
                          "subscribe",
                          "Página suscrita a los webhooks."
                        )
                      }
                    >
                      {busy === "subscribe"
                        ? "Suscribiendo…"
                        : "Reintentar suscripción"}
                    </Button>
                  )}

                {connection.id === "meta" && connection.accounts.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === "diagnose"}
                    onClick={() => void diagnose()}
                  >
                    {busy === "diagnose" ? "Comprobando…" : "Comprobar webhook"}
                  </Button>
                )}

                {connection.accounts.length > 0 && (
                  <Button
                    size="sm"
                    variant={confirming === connection.id ? "destructive" : "ghost"}
                    disabled={busy === connection.id}
                    onClick={() => {
                      if (confirming !== connection.id) {
                        setConfirming(connection.id);
                        return;
                      }
                      void post(
                        `/api/admin/social/${connection.id}/disconnect`,
                        connection.id,
                        "Cuenta desconectada. El historial se conserva."
                      );
                    }}
                  >
                    {busy === connection.id
                      ? "Desconectando…"
                      : confirming === connection.id
                        ? "Confirmar desconexión"
                        : "Desconectar"}
                  </Button>
                )}
              </div>

              {connection.id === "meta" && diagnosis && (
                <p className="text-sm text-muted-foreground" role="status">
                  {diagnosis}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Lo que ninguna API puede hacer por nosotros. */}
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Requisitos manuales
            </h2>
            <p className="text-sm text-muted-foreground">
              Estos pasos no se pueden automatizar; hay que hacerlos en cada
              plataforma.
            </p>
          </div>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Revisión de la app aprobada para <code>pages_messaging</code> e{" "}
              <code>instagram_manage_messages</code>. Sin ella solo funcionan las
              cuentas con rol en la app.
            </li>
            <li>
              En Instagram: Configuración → Mensajes → Controles de mensajes →
              Herramientas conectadas → <strong>Permitir acceso a los mensajes</strong>.
              Si está apagado, los webhooks de Instagram no llegan y no hay ningún
              error que lo indique.
            </li>
            <li>
              Auditoría de TikTok aprobada para publicar en público. Sin ella todo
              sale en privado.
            </li>
          </ul>
        </CardContent>
      </Card>

      <div>
        <Button size="sm" variant="outline" onClick={() => void reload()}>
          <RefreshCw className="size-4" aria-hidden />
          Actualizar
        </Button>
      </div>
    </div>
  );
};

export default SocialConnectionsClient;
