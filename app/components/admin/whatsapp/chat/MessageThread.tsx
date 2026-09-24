"use client";

import { ChevronsDown, Loader2 } from "lucide-react";
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { dateSeparatorLabel, sameDay } from "@/lib/crm/whatsapp-chat-format";
import MessageBubble, { type BubbleProps } from "./MessageBubble";
import { wa } from "./chatTheme";
import { Highlighted } from "./ui";
import { clockLabel, messageDomId, type ChatMessage } from "./utils";

/** A menos de esto del final se considera «abajo del todo». */
const BOTTOM_SLACK = 80;

type BubbleHandlers = Pick<
  BubbleProps,
  "canWrite" | "busy" | "onOpenMenu" | "onOpenImage" | "onResend" | "onDelete" | "onCancelDelete" | "onJumpTo"
>;

/**
 * La conversación: separadores de fecha, burbujas, «Cargar anteriores» sin
 * perder el sitio, y el botón para bajar al último mensaje con cuántos
 * llegaron mientras se leía más arriba.
 */
const MessageThread = ({
  messages,
  chatName,
  now,
  hasMore,
  loadingOlder,
  onLoadOlder,
  query,
  currentMatchId,
  flashId,
  resentIds,
  confirmDeleteId,
  stickToBottomRef,
  onScrolled,
  ...handlers
}: {
  messages: ChatMessage[];
  chatName: string;
  now: number;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  query: string;
  currentMatchId: string | null;
  flashId: string | null;
  resentIds: Set<string>;
  confirmDeleteId: string | null;
  /** Lo pone quien envía: el siguiente mensaje nuevo baja aunque se esté leyendo arriba. */
  stickToBottomRef: React.RefObject<boolean>;
  /** Al desplazarse (cierra el menú abierto). */
  onScrolled: () => void;
} & BubbleHandlers) => {
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const prepend = useRef<{ height: number; top: number } | null>(null);
  const edges = useRef<{ first: string | null; last: string | null }>({ first: null, last: null });
  const lastId = messages.at(-1)?.id ?? null;
  const [atBottom, setAtBottom] = useState(true);
  // El último mensaje que se vio abajo: lo que llegó después son «nuevos».
  const [seenId, setSeenId] = useState<string | null>(lastId);

  const byWamid = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) if (m.externalMessageId) map.set(m.externalMessageId, m);
    return map;
  }, [messages]);

  const unseen = useMemo(() => {
    if (!seenId) return 0;
    const i = messages.findIndex((m) => m.id === seenId);
    return i === -1 ? 0 : messages.slice(i + 1).filter((m) => m.kind !== "system").length;
  }, [messages, seenId]);

  const toBottom = (smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  // Mensajes nuevos o anteriores: se decide dónde queda la vista antes de pintar.
  useLayoutEffect(() => {
    const el = scroller.current;
    const first = messages[0]?.id ?? null;
    const prev = edges.current;
    edges.current = { first, last: lastId };
    if (!el) return;
    if (prev.first === null && prev.last === null) {
      // Recién abierto: abajo del todo, como WhatsApp.
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (prepend.current && first !== prev.first) {
      // «Cargar anteriores»: la vista se queda en el mensaje que se estaba leyendo.
      el.scrollTop = el.scrollHeight - prepend.current.height + prepend.current.top;
      prepend.current = null;
    }
    if (lastId !== prev.last && (nearBottom.current || stickToBottomRef.current)) {
      stickToBottomRef.current = false;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, lastId, stickToBottomRef]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK;
    nearBottom.current = bottom;
    if (bottom !== atBottom) setAtBottom(bottom);
    if (bottom && seenId !== lastId) setSeenId(lastId);
    onScrolled();
  };

  const loadOlder = () => {
    const el = scroller.current;
    if (el) prepend.current = { height: el.scrollHeight, top: el.scrollTop };
    onLoadOlder();
  };

  const nowDate = new Date(now);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-(--wa-chat-bg) px-3 py-3 md:px-[6%] md:py-4"
        // Una foto que termina de cargar empuja el chat: si se estaba abajo, se sigue abajo.
        onLoadCapture={() => {
          const el = scroller.current;
          if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
        }}
      >
        {hasMore && (
          <div className="flex justify-center py-1">
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-(--wa-surface) px-4 text-xs font-medium text-(--wa-icon) shadow-sm hover:bg-(--wa-hover) disabled:opacity-60 md:h-8"
            >
              {loadingOlder ? <Loader2 className="size-3.5 animate-spin" /> : null} Cargar mensajes anteriores
            </button>
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const separator =
            !prev || !sameDay(prev.sentAt, m.sentAt) ? (
              <div className="flex justify-center py-1.5" role="separator">
                <span className={cn("px-3 py-1 text-xs font-medium uppercase", wa.pill)}>{dateSeparatorLabel(m.sentAt, nowDate)}</span>
              </div>
            ) : null;
          if (m.kind === "system") {
            // Aviso gris centrado (reacción, encuesta, algo que solo se ve
            // en el celular): no es un mensaje que la persona escribió.
            return (
              <Fragment key={m.id}>
                {separator}
                <div id={messageDomId(m.id)} className="flex justify-center py-0.5">
                  <span className={cn("max-w-[85%] px-3 py-1 text-center text-xs", wa.pill)}>
                    {m.direction === "OUTBOUND" ? "Tú: " : ""}
                    <Highlighted text={m.body ?? ""} query={query} />
                    <span className="ml-1.5 text-[10px] text-(--wa-tick)">{clockLabel(m.sentAt)}</span>
                  </span>
                </div>
              </Fragment>
            );
          }
          return (
            <Fragment key={m.id}>
              {separator}
              <MessageBubble
                m={m}
                chatName={chatName}
                quoted={m.replyToExternalId ? (byWamid.get(m.replyToExternalId) ?? null) : undefined}
                query={query}
                isCurrentMatch={currentMatchId === m.id}
                flash={flashId === m.id}
                resent={resentIds.has(m.id)}
                confirmingDelete={confirmDeleteId === m.id}
                {...handlers}
              />
            </Fragment>
          );
        })}
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={() => toBottom(true)}
          aria-label={unseen ? `Ir al último mensaje (${unseen} nuevos)` : "Ir al último mensaje"}
          title="Ir al último mensaje"
          className="absolute right-4 bottom-4 z-20 grid size-11 place-items-center rounded-full bg-(--wa-surface) text-(--wa-icon) shadow-md hover:bg-(--wa-hover)"
        >
          <ChevronsDown className="size-5" />
          {unseen > 0 && (
            <span className="absolute -top-1.5 -left-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-(--wa-unread) px-1 text-[11px] font-semibold text-white">
              {unseen}
            </span>
          )}
        </button>
      )}
    </div>
  );
};

export default MessageThread;
