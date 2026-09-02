"use client";

import { toast } from "sonner";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import NotificationBellPopover from "@/app/components/shared/notifications/NotificationBellPopover";
import type { FeedItem } from "@/lib/notifications/platform/types";
import { cn } from "@/lib/utils";

/**
 * El interruptor del stream SSE vive en una variable de entorno del servidor
 * (NOTIFICATIONS_STREAM_ENABLED), así que tiene que bajar por props desde el
 * layout. La campana aparece en DOS cabeceras distintas del portal —la del
 * shell y la propia del reproductor del curso, que cuelga de `children`— y solo
 * una de ellas recibe props del layout: por eso un contexto y no un prop suelto.
 * Sin proveedor el valor es `false`, es decir, sondeo periódico: degradarse a
 * pedir cada 60 s es siempre preferible a abrir un stream que no debía abrirse.
 */
const StreamEnabledContext = createContext(false);

export const MemberNotificationsProvider = ({
  streamEnabled,
  children,
}: {
  streamEnabled: boolean;
  children: ReactNode;
}) => (
  <StreamEnabledContext value={streamEnabled}>{children}</StreamEnabledContext>
);

type Props = { className?: string };

/** Tono de la campana en el portal: aquí no hay barra oscura como en el CRM,
 *  la cabecera es crema — así que se apoya en el color del texto secundario. */
const triggerClass =
  "text-muted-foreground hover:bg-foreground/5 hover:text-foreground";

/** La campana del portal: el popover compartido apuntando a /api/miembros. */
const MemberNotificationBell = ({ className }: Props) => {
  const streamEnabled = useContext(StreamEnabledContext);

  // Solo se avisa por toast de lo que llegó DESPUÉS de montar. Sin esto, una
  // recarga de la lista (cambio de filtro, refresco por SSE) volvería a "ver por
  // primera vez" notificaciones antiguas y las anunciaría de nuevo.
  const mountedAtRef = useRef(0);
  useEffect(() => {
    mountedAtRef.current = Date.now();
  }, []);

  const handleNewItems = useCallback((items: FeedItem[]) => {
    for (const item of items) {
      // Para un miembro el único ERROR del catálogo es la mensualidad vencida:
      // se le pierde el acceso al curso, así que no basta con el contador.
      if (item.severity !== "ERROR") continue;
      const createdAt = new Date(item.createdAt).getTime();
      if (!Number.isFinite(createdAt) || createdAt < mountedAtRef.current) {
        continue;
      }
      toast.error(item.title, {
        description: item.body ?? undefined,
      });
    }
  }, []);

  const handleError = useCallback((message: string) => {
    toast.error(message);
  }, []);

  return (
    <NotificationBellPopover
      feedUrl="/api/miembros/notificaciones"
      streamUrl="/api/miembros/notificaciones/stream"
      streamEnabled={streamEnabled}
      // El portal no tiene página de historial (ni la va a tener: el propio
      // popover pagina hacia atrás con "Cargar más"). El pie lleva a lo único
      // que un miembro querría hacer desde aquí: apagar o encender los avisos.
      historyHref="/cuenta/notificaciones"
      historyLabel="Ajustes de notificaciones"
      triggerClassName={cn(triggerClass, className)}
      onNewItems={handleNewItems}
      onMutationError={handleError}
    />
  );
};

export default MemberNotificationBell;
