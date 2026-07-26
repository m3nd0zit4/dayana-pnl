"use client";

import { useCallback, useEffect, useRef } from "react";
import NotificationBellPopover from "@/app/components/shared/notifications/NotificationBellPopover";
import { useCrm } from "@/app/components/admin/crm/CrmProvider";
import type { FeedItem } from "@/lib/notifications/platform/types";

type Props = { className?: string };

/** La campana del CRM: el popover compartido apuntando a las rutas de /admin. */
const CrmNotificationBell = ({ className }: Props) => {
  const { preview, streamEnabled, toast } = useCrm();
  // Solo se avisa por toast de lo que llegó DESPUÉS de montar. Sin esto, un
  // recargar la lista (cambio de filtro, refresco por SSE) volvería a "ver por
  // primera vez" notificaciones antiguas y las anunciaría de nuevo.
  const mountedAtRef = useRef(0);
  useEffect(() => {
    mountedAtRef.current = Date.now();
  }, []);

  const handleNewItems = useCallback(
    (items: FeedItem[]) => {
      for (const item of items) {
        if (item.severity !== "ERROR") continue;
        const createdAt = new Date(item.createdAt).getTime();
        if (!Number.isFinite(createdAt) || createdAt < mountedAtRef.current) {
          continue;
        }
        toast({
          title: item.title,
          message: item.body ?? "Revisa el detalle en notificaciones.",
          variant: "error",
          action: item.href ? { label: "Ver", href: item.href } : undefined,
        });
      }
    },
    [toast]
  );

  const handleError = useCallback(
    (message: string) => toast({ message, variant: "error" }),
    [toast]
  );

  return (
    <NotificationBellPopover
      feedUrl="/api/admin/notifications/feed"
      streamUrl="/api/admin/notifications/stream"
      streamEnabled={streamEnabled}
      historyHref="/admin/notificaciones"
      enabled={!preview}
      triggerClassName={className}
      onNewItems={handleNewItems}
      onMutationError={handleError}
    />
  );
};

export default CrmNotificationBell;
