"use client";

import { Copy, Info, Reply } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { QUICK_REACTIONS } from "@/lib/crm/whatsapp-chat-format";
import type { ChatMessage } from "./utils";

const WIDTH = 272;
const GAP = 6;
const EDGE = 8;

/**
 * El menú de un mensaje (flecha al pasar el ratón, clic derecho o dedo
 * encima): reaccionar, responder, copiar e info. Todo mide al menos 40 px.
 */
const MessageMenu = ({
  message,
  anchor,
  reactions,
  canReply,
  onReact,
  onReply,
  onCopy,
  onInfo,
  onClose,
}: {
  message: ChatMessage;
  anchor: DOMRect;
  /** `null` si se puede reaccionar; si no, por qué no. */
  reactions: { disabledReason: string | null; mine: string | null };
  canReply: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: (() => void) | null;
  onInfo: (() => void) | null;
  onClose: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const out = message.direction === "OUTBOUND";

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(WIDTH, vw - EDGE * 2);
    const height = el.offsetHeight;
    const left = Math.min(Math.max(out ? anchor.right - width : anchor.left, EDGE), vw - width - EDGE);
    const below = anchor.bottom + GAP;
    const top =
      below + height <= vh - EDGE
        ? below
        : anchor.top - GAP - height >= EDGE
          ? anchor.top - GAP - height
          : Math.max(EDGE, (vh - height) / 2);
    // Se coloca a mano (sin estado): mide primero, luego se mueve junto al mensaje.
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.visibility = "visible";
  }, [anchor, out]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, []);

  const item =
    "flex h-11 w-full items-center gap-3 px-4 text-left text-sm text-(--wa-text) hover:bg-(--wa-hover) disabled:opacity-40 md:h-10";

  return (
    <>
      <button
        type="button"
        aria-label="Cerrar menú"
        className="fixed inset-0 z-40 cursor-default bg-transparent"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        role="menu"
        aria-label="Opciones del mensaje"
        className="fixed z-50 overflow-hidden rounded-xl border border-(--wa-divider) bg-(--wa-surface) py-1 shadow-xl"
        style={{
          width: `min(${WIDTH}px, calc(100vw - ${EDGE * 2}px))`,
          top: 0,
          left: 0,
          visibility: "hidden",
        }}
      >
        <div className="flex items-center justify-between gap-0.5 border-b border-(--wa-divider) px-1.5 pb-1" title={reactions.disabledReason ?? undefined}>
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitemcheckbox"
              disabled={reactions.disabledReason !== null}
              onClick={() => onReact(reactions.mine === emoji ? "" : emoji)}
              aria-label={reactions.mine === emoji ? `Quitar ${emoji}` : `Reaccionar ${emoji}`}
              aria-checked={reactions.mine === emoji}
              className={cn(
                "grid size-10 place-items-center rounded-full text-[22px] transition-transform hover:scale-110 hover:bg-(--wa-hover) disabled:opacity-40 disabled:hover:scale-100",
                reactions.mine === emoji && "bg-(--wa-green-soft)"
              )}
            >
              {emoji}
            </button>
          ))}
        </div>
        {reactions.disabledReason && (
          <p className="px-4 pt-1.5 text-[11px] text-(--wa-meta)">{reactions.disabledReason}</p>
        )}
        <button type="button" role="menuitem" className={item} disabled={!canReply} onClick={onReply}>
          <Reply className="size-4 text-(--wa-icon)" /> Responder
        </button>
        {onCopy && (
          <button type="button" role="menuitem" className={item} onClick={onCopy}>
            <Copy className="size-4 text-(--wa-icon)" /> Copiar texto
          </button>
        )}
        {onInfo && (
          <button type="button" role="menuitem" className={item} onClick={onInfo}>
            <Info className="size-4 text-(--wa-icon)" /> Info del mensaje
          </button>
        )}
      </div>
    </>
  );
};

export default MessageMenu;
