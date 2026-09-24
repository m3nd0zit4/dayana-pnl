"use client";

import { CalendarClock, Loader2, Paperclip, Send, Sparkles, Sticker, X } from "lucide-react";
import { forwardRef, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { windowNotice } from "@/lib/crm/whatsapp-outbound-plan";
import { quotePreview } from "@/lib/crm/whatsapp-chat-format";
import type { ChatDetail } from "@/lib/crm/whatsapp-agent/workspace";
import ApprovalBar from "../ApprovalBar";
import VoiceRecorder from "../VoiceRecorder";
import { wa } from "./chatTheme";
import { ActionButton } from "./ui";
import { mediaSrc, type ChatMessage } from "./utils";

const QUICK_REPLIES = [
  "¡Hola! Ya te leo con calma y te respondo en un momento 💛",
  "Gracias por escribir, te respondo hoy mismo.",
  "Perfecto, quedo atenta.",
];

type StickerItem = { key: string; url: string; uses: number };

/** Barra de escribir: avisos, autorizaciones, atajos, stickers y el cuadro de texto. */
const Composer = forwardRef<
  HTMLTextAreaElement,
  {
    chat: ChatDetail;
    canWrite: boolean;
    busy: string | null;
    text: string;
    onText: (text: string) => void;
    onSend: () => void;
    onSuggest: () => void;
    onSlots: () => void;
    onSendFile: (file: File, caption?: string) => Promise<void>;
    onSticker: (url: string) => void;
    onDecide: React.ComponentProps<typeof ApprovalBar>["onDecide"];
    replyTo: ChatMessage | null;
    onCancelReply: () => void;
  }
>(function Composer(
  { chat, canWrite, busy, text, onText, onSend, onSuggest, onSlots, onSendFile, onSticker, onDecide, replyTo, onCancelReply },
  textareaRef
) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [stickers, setStickers] = useState<StickerItem[] | null>(null);
  const [showStickers, setShowStickers] = useState(false);

  const openStickers = async () => {
    setShowStickers((v) => !v);
    if (stickers === null) {
      const res = await fetch("/api/admin/whatsapp/stickers", { cache: "no-store" }).catch(() => null);
      setStickers(res?.ok ? ((await res.json()) as { items: StickerItem[] }).items : []);
    }
  };

  return (
    <div className="space-y-2 bg-(--wa-panel) px-2 py-2 sm:px-3">
      {!chat.windowOpen && windowNotice(chat.windowState) && (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-(--wa-surface) px-3 py-1.5 text-xs text-(--wa-icon)">
          <span className="flex-1">{windowNotice(chat.windowState)}</span>
        </p>
      )}
      <ApprovalBar approvals={chat.approvals} canWrite={canWrite} onDecide={onDecide} />
      {chat.draft?.source === "AI" && text === chat.draft.body && (
        <p className="flex items-center gap-1 text-xs font-medium text-(--wa-accent)">
          <Sparkles className="size-3.5" /> Borrador de la IA: envíalo o cámbialo (aprende de tus cambios).
        </p>
      )}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0 [&>*]:shrink-0">
        <ActionButton tone="outline" disabled={!canWrite || busy !== null} onClick={onSuggest}>
          {busy === "suggest" ? <Loader2 className="animate-spin" /> : <Sparkles className="text-(--wa-green)" />} Que la IA proponga
        </ActionButton>
        <ActionButton tone="outline" disabled={!canWrite || busy !== null} onClick={onSlots}>
          {busy === "slots" ? <Loader2 className="animate-spin" /> : <CalendarClock className="text-(--wa-green)" />} Horas libres
        </ActionButton>
        {QUICK_REPLIES.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onText(q)}
            disabled={!canWrite}
            className={cn("h-10 max-w-[16rem] truncate rounded-full px-3 text-sm md:h-9", wa.outline)}
          >
            {q}
          </button>
        ))}
      </div>
      {showStickers && (
        <div className="max-h-56 overflow-y-auto rounded-lg bg-(--wa-surface) p-2">
          {stickers === null ? (
            <Loader2 className="mx-auto size-5 animate-spin text-(--wa-green)" />
          ) : stickers.length === 0 ? (
            <p className="p-2 text-center text-xs text-(--wa-meta)">
              Aún no hay stickers: aparecen aquí cuando Dayana manda alguno desde su celular.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-1 sm:grid-cols-8">
              {stickers.map((st) => (
                <button
                  key={st.key}
                  type="button"
                  onClick={() => {
                    setShowStickers(false);
                    onSticker(st.url);
                  }}
                  disabled={!canWrite || busy !== null || !chat.windowOpen}
                  className="grid place-items-center rounded-md p-1 hover:bg-(--wa-panel)"
                  title={`Enviar (usado ${st.uses} ${st.uses === 1 ? "vez" : "veces"})`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaSrc(st.url) ?? ""} alt="Sticker" className="size-16 object-contain" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {replyTo && (
        <div className="flex items-stretch gap-2 rounded-lg bg-(--wa-surface) p-1.5 pl-2">
          <div
            className={cn(
              "min-w-0 flex-1 rounded-md border-l-4 bg-(--wa-text)/5 px-2 py-1",
              replyTo.direction === "OUTBOUND" ? "border-(--wa-quote-out)" : "border-(--wa-quote-in)"
            )}
          >
            <span
              className={cn(
                "block text-xs font-semibold",
                replyTo.direction === "OUTBOUND" ? "text-(--wa-quote-out)" : "text-(--wa-quote-in)"
              )}
            >
              Respondiendo a {replyTo.direction === "OUTBOUND" ? "tu mensaje" : chat.name}
            </span>
            <span className="line-clamp-2 block text-xs text-(--wa-meta)">{quotePreview(replyTo)}</span>
          </div>
          <button type="button" onClick={onCancelReply} className={wa.iconButton} aria-label="No responder a ese mensaje">
            <X className="size-5" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-1 sm:gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,audio/ogg,audio/mpeg,audio/mp4,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onSendFile(file, text.trim() || undefined).then(() => onText(""));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={!canWrite || busy !== null || !chat.windowOpen}
          title="Adjuntar foto o documento"
          aria-label="Adjuntar foto o documento"
          className="grid size-[42px] shrink-0 place-items-center rounded-full text-(--wa-icon) hover:bg-(--wa-text)/5 disabled:opacity-40"
        >
          {busy === "file" ? <Loader2 className="size-5 animate-spin" /> : <Paperclip className="size-5" />}
        </button>
        <button
          type="button"
          onClick={() => void openStickers()}
          disabled={!canWrite}
          title="Stickers de Dayana"
          aria-label="Stickers de Dayana"
          aria-pressed={showStickers}
          className={cn(
            "grid size-[42px] shrink-0 place-items-center rounded-full text-(--wa-icon) hover:bg-(--wa-text)/5",
            showStickers && "bg-(--wa-text)/5 text-(--wa-green)"
          )}
        >
          <Sticker className="size-6" />
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder={canWrite ? "Escribe un mensaje" : "Solo lectura"}
          aria-label="Mensaje"
          disabled={!canWrite}
          rows={1}
          className="max-h-40 min-h-[42px] min-w-0 flex-1 resize-none rounded-lg border-0 bg-(--wa-input) px-3 py-2.5 text-base text-(--wa-text) outline-none placeholder:text-(--wa-meta) md:text-[15px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            } else if (e.key === "Escape" && replyTo) {
              onCancelReply();
            }
          }}
        />
        {text.trim() ? (
          <button
            type="button"
            onClick={onSend}
            disabled={!canWrite || !text.trim() || busy !== null || !chat.windowOpen}
            aria-label="Enviar"
            className={cn("grid size-[42px] shrink-0 place-items-center rounded-full disabled:opacity-40", wa.primary)}
          >
            {busy === "send" ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
          </button>
        ) : (
          <VoiceRecorder disabled={!canWrite || busy !== null || !chat.windowOpen} onRecorded={(file) => onSendFile(file)} />
        )}
      </div>
      {chat.aiMode === "AUTO" && !chat.paused && !chat.priority && (
        <p className="hidden text-[11px] text-(--wa-meta) md:block">
          Enter envía · Shift+Enter nueva línea · si escribes aquí, la IA se aparta unas horas.
        </p>
      )}
    </div>
  );
});

export default Composer;
