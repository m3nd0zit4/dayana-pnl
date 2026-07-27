"use client";

import type { NotificationSeverity } from "@prisma/client";
import { BellOff, CheckCheck } from "lucide-react";
import { useMemo, useState } from "react";
import NotificationBellSkeleton from "@/app/components/shared/notifications/NotificationBellSkeleton";
import NotificationItem from "@/app/components/shared/notifications/NotificationItem";
import { notificationGroup } from "@/app/components/shared/notifications/notification-icons";
import useNotificationFeed from "@/app/components/shared/notifications/useNotificationFeed";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { NOTIFICATION_GROUPS } from "@/lib/notifications/platform/catalog";
import type { FeedItem } from "@/lib/notifications/platform/types";
import CrmPageShell from "./CrmPageShell";
import CrmSegmentedControl from "./CrmSegmentedControl";
import { useCrm } from "./CrmProvider";

type Props = { preview: boolean };

const READ_SEGMENTS = [
  { id: "all", label: "Todas" },
  { id: "unread", label: "Sin leer" },
] as const;

type ReadFilter = (typeof READ_SEGMENTS)[number]["id"];

const SEVERITY_OPTIONS: { value: NotificationSeverity; label: string }[] = [
  { value: "INFO", label: "Informativa" },
  { value: "SUCCESS", label: "Éxito" },
  { value: "WARNING", label: "Advertencia" },
  { value: "ERROR", label: "Error" },
];

const ALL = "__all__";

/** Datos de mentira para la vista previa de UI (sin sesión ni base de datos). */
const PREVIEW_ITEMS: FeedItem[] = [
  {
    id: "preview-1",
    eventType: "PAYMENT_APPROVED",
    severity: "SUCCESS",
    title: "Pago aprobado · $450.000 COP",
    body: "Mercado Pago confirmó el pago de Laura Gómez para Terapia individual.",
    href: null,
    createdAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    readAt: null,
  },
  {
    id: "preview-2",
    eventType: "WEB_LEAD_SUBMITTED",
    severity: "INFO",
    title: "Formulario web recibido",
    body: "Andrés Ruiz dejó sus datos desde la página de servicios.",
    href: null,
    createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    readAt: null,
  },
  {
    id: "preview-3",
    eventType: "PAYMENT_WEBHOOK_FAILED",
    severity: "ERROR",
    title: "Error en webhook de pago",
    body: "El webhook de PayPal devolvió 500. Puede haber pagos sin registrar.",
    href: null,
    createdAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
    readAt: new Date(Date.now() - 20 * 3_600_000).toISOString(),
  },
];

const NotificationsPageClient = ({ preview }: Props) => {
  const { streamEnabled, toast } = useCrm();
  const [groupFilter, setGroupFilter] = useState<string>(ALL);
  const [severityFilter, setSeverityFilter] = useState<string>(ALL);

  const feed = useNotificationFeed({
    feedUrl: "/api/admin/notifications/feed",
    streamUrl: "/api/admin/notifications/stream",
    streamEnabled,
    enabled: !preview,
  });

  const items = preview ? PREVIEW_ITEMS : feed.items;
  const readFilter: ReadFilter = feed.unreadOnly ? "unread" : "all";

  // El API filtra por estado de lectura (y así la paginación sigue siendo
  // correcta); grupo y severidad se filtran sobre lo ya cargado.
  const visible = useMemo(
    () =>
      items.filter((item) => {
        if (
          groupFilter !== ALL &&
          notificationGroup(item.eventType) !== groupFilter
        ) {
          return false;
        }
        if (severityFilter !== ALL && item.severity !== severityFilter) {
          return false;
        }
        return true;
      }),
    [items, groupFilter, severityFilter]
  );

  const filtering = groupFilter !== ALL || severityFilter !== ALL;

  const report = async (promise: Promise<boolean>, message: string) => {
    const ok = await promise;
    if (!ok) toast({ message, variant: "error" });
  };

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Notificaciones
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Historial completo de avisos de la plataforma.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={preview || feed.unread === 0}
            onClick={() =>
              void report(feed.markAllRead(), "No se pudo marcar todo como leído")
            }
          >
            <CheckCheck />
            Marcar todo como leído
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <CrmSegmentedControl
            segments={READ_SEGMENTS}
            value={readFilter}
            onChange={(id) => feed.setUnreadOnly(id === "unread")}
            aria-label="Estado de lectura"
          />

          <Select
            value={groupFilter}
            onValueChange={(value) =>
              setGroupFilter(typeof value === "string" ? value : ALL)
            }
          >
            <SelectTrigger className="h-8 w-52" aria-label="Filtrar por grupo">
              {/* Base UI pinta el value crudo si no se le da una etiqueta. */}
              <SelectValue>
                {(value) =>
                  value === ALL ? "Todos los grupos" : String(value)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los grupos</SelectItem>
              {NOTIFICATION_GROUPS.map((group) => (
                <SelectItem key={group} value={group}>
                  {group}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={severityFilter}
            onValueChange={(value) =>
              setSeverityFilter(typeof value === "string" ? value : ALL)
            }
          >
            <SelectTrigger
              className="h-8 w-44"
              aria-label="Filtrar por severidad"
            >
              <SelectValue>
                {(value) =>
                  SEVERITY_OPTIONS.find((option) => option.value === value)
                    ?.label ?? "Cualquier severidad"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Cualquier severidad</SelectItem>
              {SEVERITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {preview && (
          <Alert>
            <BellOff />
            <AlertDescription>
              Datos de ejemplo: la vista previa no consulta el feed real.
            </AlertDescription>
          </Alert>
        )}

        {!preview && feed.error && (
          <Alert>
            <BellOff />
            <AlertDescription>{feed.error}</AlertDescription>
          </Alert>
        )}

        <Card className="overflow-hidden py-0">
          <CardContent className="p-0">
            {!preview && feed.loading && items.length === 0 ? (
              <NotificationBellSkeleton rows={6} />
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
                <BellOff className="size-6 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {filtering
                    ? "Ningún aviso coincide con los filtros."
                    : "No tienes notificaciones."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {visible.map((item) => (
                  <NotificationItem
                    key={item.id}
                    item={item}
                    showEventLabel
                    onActivate={(target) => {
                      if (preview || target.readAt !== null) return;
                      void report(
                        feed.markRead([target.id]),
                        "No se pudo marcar como leída"
                      );
                    }}
                    onDismiss={
                      preview
                        ? undefined
                        : (target) =>
                            void report(
                              feed.dismiss([target.id]),
                              "No se pudo descartar la notificación"
                            )
                    }
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {!preview && feed.hasMore && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              disabled={feed.loadingMore}
              onClick={feed.loadMore}
            >
              {feed.loadingMore ? "Cargando…" : "Cargar más"}
            </Button>
          </div>
        )}
      </div>
    </CrmPageShell>
  );
};

export default NotificationsPageClient;
