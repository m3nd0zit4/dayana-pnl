"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/app/components/ui/popover";
import { ScrollArea } from "@/app/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import type { FeedItem } from "@/lib/notifications/platform/types";
import { cn } from "@/lib/utils";
import NotificationBellSkeleton from "./NotificationBellSkeleton";
import NotificationItem from "./NotificationItem";
import useNotificationFeed from "./useNotificationFeed";

type Props = {
  /** GET/POST del feed. Nunca se codifica una ruta dentro de este componente. */
  feedUrl: string;
  streamUrl: string;
  streamEnabled: boolean;
  /** Página de historial completo a la que apunta el pie del popover. */
  historyHref: string;
  /** false ⇒ campana inerte (vista previa del CRM). */
  enabled?: boolean;
  /** Clases del botón disparador, para que cada superficie ponga su tema. */
  triggerClassName?: string;
  onNewItems?: (items: FeedItem[]) => void;
  onMutationError?: (message: string) => void;
};

const MAX_BADGE = 99;

const NotificationBellPopover = ({
  feedUrl,
  streamUrl,
  streamEnabled,
  historyHref,
  enabled = true,
  triggerClassName,
  onNewItems,
  onMutationError,
}: Props) => {
  const [open, setOpen] = useState(false);
  const feed = useNotificationFeed({
    feedUrl,
    streamUrl,
    streamEnabled,
    enabled,
    onNewItems,
  });

  const {
    items,
    unread,
    loading,
    loadingMore,
    error,
    hasMore,
    unreadOnly,
    setUnreadOnly,
    loadMore,
    markRead,
    markAllRead,
    dismiss,
  } = feed;

  const badgeLabel = unread > MAX_BADGE ? `${MAX_BADGE}+` : String(unread);

  const report = async (promise: Promise<boolean>, message: string) => {
    const ok = await promise;
    if (!ok) onMutationError?.(message);
  };

  const emptyCopy = unreadOnly
    ? "No tienes notificaciones sin leer"
    : "No tienes notificaciones";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn("relative", triggerClassName)}
            aria-label={
              unread > 0
                ? `Notificaciones (${badgeLabel} sin leer)`
                : "Notificaciones"
            }
          />
        }
      >
        <Bell />
        {unread > 0 && (
          <Badge
            aria-hidden
            className="absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full px-1 text-[10px] leading-none tabular-nums"
          >
            {badgeLabel}
          </Badge>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[380px] max-w-[calc(100vw-1.5rem)] gap-0 p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="text-sm font-semibold">Notificaciones</p>
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-foreground"
            disabled={unread === 0}
            onClick={() =>
              void report(
                markAllRead(),
                "No se pudo marcar todo como leído"
              )
            }
          >
            <CheckCheck />
            Marcar todo como leído
          </Button>
        </div>

        <div className="px-3 pt-2 pb-1">
          <Tabs
            value={unreadOnly ? "unread" : "all"}
            onValueChange={(next) => setUnreadOnly(next === "unread")}
          >
            <TabsList className="w-full" aria-label="Filtro de notificaciones">
              <TabsTrigger value="all">Todas</TabsTrigger>
              <TabsTrigger value="unread">
                {unread > 0 ? `Sin leer (${badgeLabel})` : "Sin leer"}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* El Viewport de Base UI hereda `size-full`, así que una altura máxima
            solo en la raíz no acota nada: hay que acotar el viewport. */}
        <ScrollArea className="max-h-[360px] [&>[data-slot=scroll-area-viewport]]:max-h-[360px]">
          {loading && items.length === 0 ? (
            <NotificationBellSkeleton />
          ) : error && items.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              {error}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
              <Bell className="size-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{emptyCopy}</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((item) => (
                <NotificationItem
                  key={item.id}
                  item={item}
                  onActivate={(target) => {
                    if (target.readAt === null) {
                      void report(
                        markRead([target.id]),
                        "No se pudo marcar como leída"
                      );
                    }
                    if (target.href) setOpen(false);
                  }}
                  onDismiss={(target) =>
                    void report(
                      dismiss([target.id]),
                      "No se pudo descartar la notificación"
                    )
                  }
                />
              ))}

              {hasMore && (
                <div className="p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-muted-foreground"
                    disabled={loadingMore}
                    onClick={loadMore}
                  >
                    {loadingMore ? "Cargando…" : "Cargar más"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <div className="border-t border-border p-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground hover:text-foreground"
            nativeButton={false}
            render={<Link href={historyHref} />}
            onClick={() => setOpen(false)}
          >
            Ver todo el historial
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBellPopover;
