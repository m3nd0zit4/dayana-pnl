"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GoogleService } from "@prisma/client";
import { CalendarDays, FolderOpen, Plus, Trash2, TriangleAlert, UsersRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/app/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/components/ui/avatar";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";

type AccountSummary = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  services: GoogleService[];
  isActive: boolean;
  lastError: string | null;
};

type Props = {
  enabled: boolean;
  initialAccounts: AccountSummary[];
  /** Mensaje de vuelta del consentimiento (?google=connected|denied|…). */
  connectResult: string | null;
};

const SERVICES: {
  id: GoogleService;
  label: string;
  description: string;
  Icon: typeof CalendarDays;
}[] = [
  {
    id: "CALENDAR",
    label: "Calendario",
    description: "Ver la agenda y crear eventos, con enlace de Meet incluido.",
    Icon: CalendarDays,
  },
  {
    id: "CONTACTS",
    label: "Contactos",
    description: "Buscar en la agenda de Google e importar al CRM. Solo lectura.",
    Icon: UsersRound,
  },
  {
    id: "DRIVE",
    label: "Drive",
    description: "Subir archivos y compartirlos por enlace. No ve el Drive que ya existe.",
    Icon: FolderOpen,
  },
];

const CONNECT_MESSAGE: Record<string, { title: string; ok: boolean }> = {
  connected: { title: "Cuenta de Google conectada.", ok: true },
  denied: { title: "No se completó el permiso en Google. No se conectó nada.", ok: false },
  invalid: { title: "La vuelta de Google llegó incompleta. Inténtalo otra vez.", ok: false },
  not_found: { title: "Esa conexión ya no existe. Empieza de nuevo.", ok: false },
};

const initials = (account: AccountSummary) =>
  (account.displayName ?? account.email ?? "G").slice(0, 1).toUpperCase();

const GoogleAccountsClient = ({ enabled, initialAccounts, connectResult }: Props) => {
  const router = useRouter();
  const { toast, confirm } = useCrm();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [newServices, setNewServices] = useState<GoogleService[]>(["CALENDAR"]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const banner = connectResult ? CONNECT_MESSAGE[connectResult] : undefined;

  const toggleNewService = (service: GoogleService, checked: boolean) =>
    setNewServices((prev) =>
      checked ? [...prev, service] : prev.filter((s) => s !== service)
    );

  const connect = async () => {
    if (newServices.length === 0) return;
    setConnecting(true);
    try {
      const res = await fetch("/api/admin/google/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ services: newServices }),
      });
      const data = (await res.json()) as { url?: string; detail?: string };
      if (!res.ok || !data.url) {
        toast(data.detail ?? "No se pudo iniciar el permiso con Google.", "error");
        return;
      }
      // Misma pestaña a propósito: Google vuelve a nuestro callback y de ahí a
      // esta pantalla, así que la redirección cierra el círculo sola. Abrirlo
      // en otra pestaña dejaría esta desactualizada sin que se note.
      window.location.assign(data.url);
    } catch {
      toast("No se pudo contactar con el servidor.", "error");
    } finally {
      setConnecting(false);
    }
  };

  const updateServices = async (account: AccountSummary, services: GoogleService[]) => {
    setBusyId(account.id);
    try {
      const res = await fetch(`/api/admin/google/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ services }),
      });
      const data = (await res.json()) as { url?: string | null; detail?: string };
      if (!res.ok) {
        toast(data.detail ?? "No se pudo actualizar la cuenta.", "error");
        return;
      }

      // Añadir un servicio añade scopes, y Google no los concede
      // retroactivamente: hay que volver a pasar por el consentimiento.
      if (data.url) {
        toast("Falta autorizar el servicio nuevo en Google.", "info");
        window.location.assign(data.url);
        return;
      }

      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? { ...a, services } : a))
      );
      toast("Servicios actualizados.");
    } catch {
      toast("No se pudo contactar con el servidor.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const disconnect = (account: AccountSummary) =>
    confirm({
      title: "Desconectar cuenta",
      message: `El asistente dejará de usar ${account.email ?? "esta cuenta"}. El permiso sigue existiendo en Google hasta que lo retires desde myaccount.google.com/permissions.`,
      onConfirm: async () => {
        setBusyId(account.id);
        try {
          const res = await fetch(`/api/admin/google/accounts/${account.id}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            toast("No se pudo desconectar la cuenta.", "error");
            return;
          }
          setAccounts((prev) => prev.filter((a) => a.id !== account.id));
          toast("Cuenta desconectada.");
          router.refresh();
        } finally {
          setBusyId(null);
        }
      },
    });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Cuentas de Google</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Conecta una o varias cuentas y elige qué puede ver el asistente en cada
          una. Los permisos los guarda Vercel Connect; aquí no se almacena
          ninguna contraseña ni ningún token.
        </p>
      </div>

      {banner && (
        <Alert variant={banner.ok ? "default" : "destructive"}>
          <AlertTitle>{banner.title}</AlertTitle>
        </Alert>
      )}

      {!enabled && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>Google todavía no está configurado</AlertTitle>
          <AlertDescription>
            Falta la variable <code>GOOGLE_CONNECT_CONNECTOR</code>. Se define
            con el UID del conector después de crearlo con{" "}
            <code>vercel connect create</code> y enlazarlo al proyecto con{" "}
            <code>vercel connect attach</code>.
          </AlertDescription>
        </Alert>
      )}

      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay ninguna cuenta conectada todavía.
        </p>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <Card key={account.id}>
              <CardContent className="space-y-4 pt-6">
                <div className="flex items-start gap-3">
                  <Avatar className="size-9 shrink-0">
                    {account.avatarUrl && (
                      <AvatarImage src={account.avatarUrl} alt="" />
                    )}
                    <AvatarFallback>{initials(account)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {account.displayName ?? account.email ?? "Cuenta sin verificar"}
                    </p>
                    {account.email && account.displayName && (
                      <p className="truncate text-xs text-muted-foreground">
                        {account.email}
                      </p>
                    )}
                  </div>
                  <Badge variant={account.isActive ? "default" : "secondary"}>
                    {account.isActive ? "Conectada" : "Sin autorizar"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label="Desconectar cuenta"
                    disabled={busyId === account.id}
                    onClick={() => disconnect(account)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>

                {!account.isActive && (
                  <Alert variant="destructive">
                    <TriangleAlert className="size-4" />
                    <AlertTitle>Hay que volver a autorizarla</AlertTitle>
                    <AlertDescription>
                      {account.lastError ??
                        "El permiso no llegó a completarse o Google lo retiró."}{" "}
                      Vuelve a marcar un servicio para reiniciar el permiso.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-2 sm:grid-cols-3">
                  {SERVICES.map(({ id, label, description, Icon }) => {
                    const checked = account.services.includes(id);
                    return (
                      <label
                        key={id}
                        className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm"
                      >
                        <Checkbox
                          checked={checked}
                          disabled={busyId === account.id}
                          onCheckedChange={(next) =>
                            updateServices(
                              account,
                              next
                                ? [...account.services, id]
                                : account.services.filter((s) => s !== id)
                            )
                          }
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 font-medium">
                            <Icon className="size-3.5" /> {label}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <Label className="text-sm font-medium">Conectar otra cuenta</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Elige qué servicios quieres antes de continuar: Google pide el
              permiso de todos a la vez, y añadir uno después obliga a repetir el
              proceso.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {SERVICES.map(({ id, label, description, Icon }) => (
              <label
                key={id}
                className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm"
              >
                <Checkbox
                  checked={newServices.includes(id)}
                  onCheckedChange={(next) => toggleNewService(id, Boolean(next))}
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Icon className="size-3.5" /> {label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {description}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <Button
            onClick={connect}
            disabled={!enabled || connecting || newServices.length === 0}
          >
            <Plus className="size-4" />
            {connecting ? "Abriendo Google…" : "Conectar cuenta de Google"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default GoogleAccountsClient;
