"use client";

import { Bot, Check, CheckCheck, ChevronDown, Loader2, RotateCcw, Smartphone, Trash2 } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { deliveryLabel } from "@/lib/crm/whatsapp-delivery-labels";
import { quotePreview } from "@/lib/crm/whatsapp-chat-format";
import AttachmentView from "./AttachmentView";
import { wa } from "./chatTheme";
import { Highlighted, Linkified } from "./ui";
import { clockLabel, messageDomId, type ChatMessage } from "./utils";

/** Cuánto hay que dejar el dedo encima para abrir el menú del mensaje. */
const LONG_PRESS_MS = 450;

export type BubbleProps = {
  m: ChatMessage;
  /** Nombre de la persona del chat (para la cita de sus mensajes). */
  chatName: string;
  /** El mensaje citado: `undefined` si no cita nada, `null` si no está cargado. */
  quoted: ChatMessage | null | undefined;
  query: string;
  isCurrentMatch: boolean;
  flash: boolean;
  canWrite: boolean;
  busy: string | null;
  resent: boolean;
  confirmingDelete: boolean;
  onJumpTo: (messageId: string) => void;
  onOpenMenu: (m: ChatMessage, anchor: DOMRect) => void;
  onOpenImage: (image: { src: string; alt: string }) => void;
  onResend: (id: string) => void;
  onDelete: (id: string) => void;
  onCancelDelete: (id: string) => void;
};

const Quote = ({
  quoted,
  out,
  chatName,
  onJumpTo,
}: {
  quoted: ChatMessage | null;
  out: boolean;
  chatName: string;
  onJumpTo: (id: string) => void;
}) => {
  const quotedOut = quoted?.direction === "OUTBOUND";
  const body = (
    <>
      <span className={cn("block text-xs font-semibold", quotedOut ? "text-(--wa-quote-out)" : "text-(--wa-quote-in)")}>
        {quoted ? (quotedOut ? "Tú" : chatName) : "Mensaje citado"}
      </span>
      <span className="line-clamp-2 block text-xs text-(--wa-meta)">
        {quoted ? quotePreview(quoted) : "No está entre los mensajes cargados."}
      </span>
    </>
  );
  const cls = cn(
    "mb-1 block w-full min-w-0 rounded-md border-l-4 bg-(--wa-text)/5 px-2 py-1 text-left",
    quoted ? (quotedOut ? "border-(--wa-quote-out)" : "border-(--wa-quote-in)") : "border-(--wa-meta)",
    out && "bg-(--wa-text)/[0.07]"
  );
  return quoted ? (
    <button type="button" className={cn(cls, "hover:bg-(--wa-text)/10")} onClick={() => onJumpTo(quoted.id)} title="Ir al mensaje citado">
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
};

/** Una burbuja del chat, con su cita, adjuntos, hora, ✓✓, reacciones y el menú. */
const MessageBubble = ({
  m,
  chatName,
  quoted,
  query,
  isCurrentMatch,
  flash,
  canWrite,
  busy,
  resent,
  confirmingDelete,
  onJumpTo,
  onOpenMenu,
  onOpenImage,
  onResend,
  onDelete,
  onCancelDelete,
}: BubbleProps) => {
  const out = m.direction === "OUTBOUND";
  const bubbleRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const onlySticker = !m.body && m.attachments.length > 0 && m.attachments.every((a) => a.kind === "sticker" && a.url);

  const openMenu = () => {
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (rect) onOpenMenu(m, rect);
  };
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  // Celular: dejar el dedo encima abre el menú (en iOS no hay «contextmenu»).
  const touch = {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      cancelPress();
      press.current = { timer: setTimeout(() => { press.current = null; openMenu(); }, LONG_PRESS_MS), x: t.clientX, y: t.clientY };
    },
    onTouchMove: (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (press.current && Math.hypot(t.clientX - press.current.x, t.clientY - press.current.y) > 10) cancelPress();
    },
    onTouchEnd: cancelPress,
    onTouchCancel: cancelPress,
    // Clic derecho, o el toque largo de Android.
    onContextMenu: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("a,audio,video")) return;
      e.preventDefault();
      cancelPress();
      openMenu();
    },
  };

  const meta = (
    <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-(--wa-meta)">
      {m.isEcho && <Smartphone className="size-3" aria-label="Desde el celular" />}
      {m.editedAt && (
        <span title={m.originalBody ? `Antes decía: ${m.originalBody}` : undefined} className="italic">
          Editado ·
        </span>
      )}
      {m.staffName && !m.isAutoReply && <span>{m.staffName} ·</span>}
      <span>{clockLabel(m.sentAt)}</span>
      {out && m.status !== "FAILED" && (
        <span title={deliveryLabel(m.status).label} className="inline-flex">
          {m.status === "SENT" ? (
            <Check className="size-4 text-(--wa-tick)" />
          ) : (
            <CheckCheck className={cn("size-4", m.status === "READ" ? "text-(--wa-read)" : "text-(--wa-tick)")} />
          )}
        </span>
      )}
      {m.status === "FAILED" && (
        <span className="font-medium text-(--wa-danger)" title={m.failedReason ?? undefined}>
          {deliveryLabel("FAILED", m.failedReason).label}
        </span>
      )}
    </div>
  );

  const menuButton = (
    <button
      type="button"
      onClick={openMenu}
      aria-label="Opciones del mensaje"
      title="Opciones"
      className={cn(
        "absolute top-0.5 right-0.5 z-10 hidden size-7 place-items-center rounded-full text-(--wa-icon) opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 md:grid",
        out ? "bg-(--wa-bubble-out)" : "bg-(--wa-bubble-in)"
      )}
    >
      <ChevronDown className="size-4" />
    </button>
  );

  return (
    <div
      id={messageDomId(m.id)}
      className={cn("flex scroll-mt-16 scroll-mb-16", out ? "justify-end" : "justify-start")}
    >
      {onlySticker ? (
        <div ref={bubbleRef} className={cn("group relative flex flex-col select-none", out ? "items-end" : "items-start")} {...touch}>
          {menuButton}
          {m.attachments.map((a, i) => (
            <AttachmentView key={i} a={a} />
          ))}
          <div className="rounded-full bg-(--wa-surface)/80 px-1.5">{meta}</div>
          {m.reactions.length > 0 && (
            <span className="-mt-1 rounded-full border border-(--wa-divider) bg-(--wa-surface) px-1.5 py-0.5 text-sm shadow-sm">
              {m.reactions.map((r) => r.emoji).join(" ")}
            </span>
          )}
        </div>
      ) : (
        <div
          ref={bubbleRef}
          className={cn(
            "group relative max-w-[88%] min-w-0 rounded-lg px-2.5 pt-1.5 pb-1 text-[14.2px] leading-snug text-(--wa-text) transition-shadow md:max-w-[75%] [-webkit-touch-callout:none]",
            wa.bubbleShadow,
            out ? cn("rounded-tr-none", wa.bubbleOut) : cn("rounded-tl-none", wa.bubbleIn),
            m.status === "FAILED" && "ring-1 ring-(--wa-danger)",
            isCurrentMatch && "ring-2 ring-(--wa-green)",
            flash && "ring-2 ring-(--wa-read)",
            m.reactions.length > 0 && "mb-3"
          )}
          {...touch}
        >
          {menuButton}
          {m.isAutoReply && (
            <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-(--wa-accent)">
              <Bot className="size-3" /> Asistente IA
            </div>
          )}
          {m.replyToExternalId && quoted !== undefined && (
            <Quote quoted={quoted} out={out} chatName={chatName} onJumpTo={onJumpTo} />
          )}
          {m.attachments.map((a, i) => (
            <AttachmentView key={i} a={a} onOpenImage={onOpenImage} />
          ))}
          {m.revokedAt ? (
            <p className="text-sm text-(--wa-meta) italic">
              🚫 {out ? "Eliminaste" : "Eliminó"} este mensaje
              {m.body ? <span className="block text-xs not-italic opacity-70">Decía: {m.body}</span> : null}
            </p>
          ) : (
            m.body && (
              <p className="break-words whitespace-pre-wrap">
                <Linkified text={m.body} query={query} />
              </p>
            )
          )}
          {!m.body && query && m.attachments.some((a) => a.caption) && (
            <p className="text-xs text-(--wa-meta)">
              <Highlighted text={m.attachments.map((a) => a.caption).filter(Boolean).join(" · ")} query={query} />
            </p>
          )}
          {meta}
          {m.reactions.length > 0 && (
            <div className={cn("absolute -bottom-3.5 flex", out ? "left-2" : "right-2")}>
              <span
                className="rounded-full border border-(--wa-divider) bg-(--wa-surface) px-1.5 py-0.5 text-sm leading-none shadow-sm"
                title={m.reactions.map((r) => `${r.actor === "business" ? "Tú" : "Persona"}: ${r.emoji}`).join(" · ")}
              >
                {m.reactions.map((r) => r.emoji).join(" ")}
              </span>
            </div>
          )}
          {m.status === "FAILED" && out && (
            <div className="mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-(--wa-danger)/20 pt-1">
              {resent ? (
                <span className="text-[11px] font-medium text-(--wa-accent)">Reenviado: míralo abajo</span>
              ) : (
                <button
                  type="button"
                  disabled={!canWrite || busy !== null}
                  onClick={() => onResend(m.id)}
                  className={cn("inline-flex h-10 items-center gap-1 rounded-full px-3 text-xs font-medium disabled:opacity-50 md:h-7", wa.primary)}
                >
                  {busy === `resend:${m.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                  Reenviar
                </button>
              )}
              <button
                type="button"
                disabled={!canWrite || busy !== null}
                onClick={() => onDelete(m.id)}
                onBlur={() => onCancelDelete(m.id)}
                title="La persona nunca lo vio: se quita solo de aquí"
                className={cn("inline-flex h-10 items-center gap-1 rounded-full px-3 text-xs font-medium disabled:opacity-50 md:h-7", wa.danger)}
              >
                {busy === `delete:${m.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                {confirmingDelete ? "¿Seguro? Eliminar" : "Eliminar"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MessageBubble;
