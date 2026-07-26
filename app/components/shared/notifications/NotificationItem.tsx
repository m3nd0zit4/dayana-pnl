"use client";

import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { X } from "lucide-react";
import Link from "next/link";
import { createElement } from "react";
import type { FeedItem } from "@/lib/notifications/platform/types";
import { cn } from "@/lib/utils";
import {
  notificationIcon,
  notificationLabel,
  severityTone,
  TONE_DOT_CLASS,
  TONE_ICON_CLASS,
} from "./notification-icons";

type Props = {
  item: FeedItem;
  /** Se dispara al activar la fila (además de navegar, si hay href). */
  onActivate?: (item: FeedItem) => void;
  onDismiss?: (item: FeedItem) => void;
  /** Muestra la etiqueta del evento sobre el título (historial completo). */
  showEventLabel?: boolean;
  className?: string;
};

const relativeTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return formatDistanceToNow(date, { addSuffix: true, locale: es });
};

const absoluteTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-CO");
};

const NotificationItem = ({
  item,
  onActivate,
  onDismiss,
  showEventLabel = false,
  className,
}: Props) => {
  const tone = severityTone(item.severity);
  // `createElement` y no `<Icon />`: el icono sale de una tabla en tiempo de
  // render, y una variable en mayúscula usada como JSX hace saltar a
  // react-hooks/static-components (cree que se define un componente aquí).
  const icon = createElement(notificationIcon(item.eventType, item.severity), {
    className: "size-4",
  });
  const unread = item.readAt === null;
  // Muchas notificaciones de miembro no llevan href a propósito (una misma fila
  // la comparten staff y miembro, y un /admin/... mandaría al miembro al muro
  // de acceso). Sin destino, la fila solo sigue siendo pulsable mientras quede
  // algo que hacer: marcarla como leída. Ya leída y sin href se dibuja como
  // texto plano —sin botón muerto ni hover que prometa una navegación que no
  // existe— para que se lea como intencional y no como un enlace roto.
  const interactive = Boolean(item.href) || (unread && Boolean(onActivate));

  const titleClass = cn(
    "text-left text-sm text-foreground focus-visible:outline-none",
    // El pseudo-elemento estira el área clicable a toda la fila sin anidar
    // interactivos, para que la × de descartar siga siendo pulsable.
    interactive && "after:absolute after:inset-0 after:content-['']",
    unread ? "font-semibold" : "font-medium"
  );

  return (
    <div
      className={cn(
        "group/notification relative flex gap-3 px-3 py-3 transition-colors focus-within:bg-muted/60",
        interactive && "hover:bg-muted/60",
        unread && "bg-primary/[0.04]",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
          TONE_ICON_CLASS[tone]
        )}
      >
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        {showEventLabel && (
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {notificationLabel(item.eventType)}
          </p>
        )}

        <div className="flex items-start gap-1.5">
          {item.href ? (
            <Link
              href={item.href}
              className={titleClass}
              onClick={() => onActivate?.(item)}
            >
              {item.title}
            </Link>
          ) : interactive ? (
            <button
              type="button"
              className={titleClass}
              onClick={() => onActivate?.(item)}
            >
              {item.title}
            </button>
          ) : (
            <p className={titleClass}>{item.title}</p>
          )}
          {unread && (
            <span
              aria-label="Sin leer"
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                TONE_DOT_CLASS[tone]
              )}
            />
          )}
        </div>

        {item.body && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {item.body}
          </p>
        )}

        <p
          className="mt-1 text-[11px] text-muted-foreground"
          title={absoluteTime(item.createdAt)}
        >
          {relativeTime(item.createdAt)}
        </p>
      </div>

      {/* La × va siempre visible (atenuada) en vez de solo en hover: en táctil
          no hay hover, y mezclar `md:opacity-0` con `group-hover` deja el
          resultado a merced del orden de las utilidades generadas. */}
      {onDismiss && (
        <button
          type="button"
          aria-label="Descartar notificación"
          className="relative z-10 -mr-1 size-6 shrink-0 self-start rounded-md text-muted-foreground opacity-40 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none group-hover/notification:opacity-100"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDismiss(item);
          }}
        >
          <X className="mx-auto size-3.5" />
        </button>
      )}
    </div>
  );
};

export default NotificationItem;
