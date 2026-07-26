"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";

type Delivery = {
  id: string;
  channel: string;
  status: string;
  subject: string | null;
  recipient: string | null;
  providerId: string | null;
  errorMessage: string | null;
  templateKey: string | null;
  sentAt: string | null;
  createdAt: string;
  contact: { id: string; firstName: string; lastName: string | null } | null;
  staffUser: { id: string; displayName: string } | null;
};

const CHANNELS = [
  { value: "", label: "Todos los canales" },
  { value: "EMAIL", label: "Correo" },
  { value: "SMS", label: "SMS" },
  { value: "WHATSAPP_API", label: "WhatsApp API" },
  { value: "WHATSAPP_LINK", label: "WhatsApp enlace" },
  { value: "INTERNAL", label: "Interno" },
];

const STATUSES = [
  { value: "", label: "Todos los estados" },
  { value: "SENT", label: "Enviado" },
  { value: "PENDING", label: "Pendiente" },
  { value: "FAILED", label: "Fallido" },
  { value: "SKIPPED", label: "Omitido" },
];

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  SENT: "default",
  PENDING: "outline",
  FAILED: "destructive",
  SKIPPED: "secondary",
};

const STATUS_LABEL: Record<string, string> = {
  SENT: "Enviado",
  PENDING: "Pendiente",
  FAILED: "Fallido",
  SKIPPED: "Omitido",
};

const CHANNEL_LABEL: Record<string, string> = {
  EMAIL: "Correo",
  SMS: "SMS",
  WHATSAPP_API: "WhatsApp API",
  WHATSAPP_LINK: "WhatsApp enlace",
  INTERNAL: "Interno",
};

const PAGE_SIZE = 50;

/**
 * Filtros ya confirmados, es decir los que están reflejados en la lista.
 *
 * Se guardan como un solo objeto a propósito: es lo que hace que el efecto de
 * carga tenga una única dependencia honesta. Si cada filtro fuera su propio
 * estado habría que mentirle a `exhaustive-deps` para que el texto del
 * destinatario no disparara una petición por cada tecla.
 */
type Query = {
  channel: string;
  status: string;
  recipient: string;
  from: string;
  to: string;
  skip: number;
};

const EMPTY_QUERY: Query = {
  channel: "",
  status: "",
  recipient: "",
  from: "",
  to: "",
  skip: 0,
};

const NotificationDeliveryLogClient = () => {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState<Query>(EMPTY_QUERY);
  // El texto del destinatario se escribe aquí y solo pasa a `query` al buscar.
  const [recipientInput, setRecipientInput] = useState("");

  const { channel, status, from, to, skip } = query;

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      // Se cede el turno antes del primer setState: dentro del cuerpo del
      // efecto dispararía un render en cascada (regla del compilador de React).
      await Promise.resolve();
      if (controller.signal.aborted) return;

      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        skip: String(query.skip),
      });
      if (query.channel) params.set("channel", query.channel);
      if (query.status) params.set("status", query.status);
      if (query.recipient) params.set("recipient", query.recipient);
      if (query.from) params.set("from", query.from);
      if (query.to) params.set("to", query.to);

      try {
        const res = await fetch(
          `/api/admin/notifications/deliveries?${params.toString()}`,
          { signal: controller.signal }
        );
        const data = (await res.json()) as {
          deliveries?: Delivery[];
          total?: number;
          error?: string;
        };
        if (controller.signal.aborted) return;

        if (!res.ok) {
          setError(
            data.error === "forbidden"
              ? "Solo el rol OWNER puede ver el registro de envíos."
              : "No se pudo cargar el registro."
          );
          setDeliveries([]);
          setTotal(0);
          return;
        }

        setDeliveries(data.deliveries ?? []);
        setTotal(data.total ?? 0);
      } catch {
        // Abortar al cambiar de filtro no es un error que mostrar.
        if (!controller.signal.aborted) {
          setError("No se pudo cargar el registro. Revisa tu conexión.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void run();
    return () => controller.abort();
  }, [query]);

  /** Cualquier cambio de filtro vuelve a la primera página. */
  const applyFilter = (patch: Partial<Query>) =>
    setQuery((prev) => ({ ...prev, ...patch, skip: 0 }));

  const search = () => applyFilter({ recipient: recipientInput.trim() });

  const resetFilters = () => {
    setRecipientInput("");
    setQuery(EMPTY_QUERY);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Filtros
            </h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="filter-channel">Canal</Label>
              <select
                id="filter-channel"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={channel}
                onChange={(e) => applyFilter({ channel: e.target.value })}
              >
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-status">Estado</Label>
              <select
                id="filter-status"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={status}
                onChange={(e) => applyFilter({ status: e.target.value })}
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-recipient">Destinatario</Label>
              <div className="flex gap-2">
                <Input
                  id="filter-recipient"
                  placeholder="correo o teléfono"
                  value={recipientInput}
                  onChange={(e) => setRecipientInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") search();
                  }}
                />
                <Button type="button" variant="outline" onClick={search}>
                  Buscar
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-from">Desde</Label>
              <Input
                id="filter-from"
                type="date"
                value={from}
                onChange={(e) => applyFilter({ from: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-to">Hasta</Label>
              <Input
                id="filter-to"
                type="date"
                value={to}
                onChange={(e) => applyFilter({ to: e.target.value })}
              />
            </div>

            <div className="flex items-end">
              <Button type="button" variant="ghost" onClick={resetFilters}>
                Limpiar filtros
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert>
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden py-0">
        <CardContent className="divide-y divide-border p-0 text-sm">
          {loading && (
            <div className="p-6 text-muted-foreground">Cargando…</div>
          )}

          {!loading && deliveries.length === 0 && !error && (
            <div className="p-6 text-muted-foreground">
              No hay envíos que coincidan con estos filtros.
            </div>
          )}

          {!loading &&
            deliveries.map((d) => {
              // Un envío apunta a un contacto o a un miembro del staff; ambos
              // son posibles ahora que las alertas internas se registran aquí.
              const target = d.contact
                ? {
                    href: `/admin/contacts/${d.contact.id}`,
                    label: [d.contact.firstName, d.contact.lastName]
                      .filter(Boolean)
                      .join(" "),
                    kind: "Contacto",
                  }
                : d.staffUser
                  ? {
                      href: "/admin/team",
                      label: d.staffUser.displayName,
                      kind: "Staff",
                    }
                  : null;

              return (
                <div key={d.id} className="space-y-1 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANT[d.status] ?? "secondary"}>
                      {STATUS_LABEL[d.status] ?? d.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {CHANNEL_LABEL[d.channel] ?? d.channel}
                    </span>
                    <span className="min-w-0 truncate font-medium">
                      {d.subject ?? d.templateKey ?? "—"}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono">{d.recipient ?? "—"}</span>
                    {target && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{target.kind}:</span>
                        <Link
                          href={target.href}
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          {target.label}
                        </Link>
                      </>
                    )}
                    <span aria-hidden>·</span>
                    <span>{new Date(d.createdAt).toLocaleString("es-CO")}</span>
                    {d.providerId && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="font-mono">{d.providerId}</span>
                      </>
                    )}
                  </div>

                  {d.errorMessage && (
                    <p className="text-xs text-destructive">{d.errorMessage}</p>
                  )}
                </div>
              );
            })}
        </CardContent>
      </Card>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {skip + 1}–{Math.min(skip + deliveries.length, total)} de {total}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || skip === 0}
              onClick={() =>
                setQuery((prev) => ({
                  ...prev,
                  skip: Math.max(0, prev.skip - PAGE_SIZE),
                }))
              }
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || skip + deliveries.length >= total}
              onClick={() =>
                setQuery((prev) => ({ ...prev, skip: prev.skip + PAGE_SIZE }))
              }
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationDeliveryLogClient;
