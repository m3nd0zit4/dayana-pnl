"use client";

import { ShieldAlert, Smartphone, Star } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { deliveryLabel } from "@/lib/crm/whatsapp-delivery-labels";
import type { ChatListItem } from "@/lib/crm/whatsapp-agent/workspace";
import { APPROVAL_LABEL, RunStatus, agoLabel, attentionLabel, isRunLive } from "../status";
import { Avatar, ModeTag, Ticks } from "./ui";
import { timeLabel } from "./utils";

/** Quién contestó lo último (cuando no hay nada más importante que decir). */
const REPLY_LABEL: Partial<Record<NonNullable<ChatListItem["replyState"]>, string>> = {
  you: "Respondiste",
  you_phone: "Respondiste desde el celular",
  ai: "La IA respondió",
  auto: "Mensaje automático",
};

const AttentionState = ({ attention, now }: { attention: NonNullable<ChatListItem["attention"]>; now: number }) => (
  <span
    className={cn(
      "inline-flex min-w-0 items-center gap-1 truncate text-xs font-medium",
      attention.urgent ? "text-(--wa-danger)" : "text-(--wa-attention)"
    )}
  >
    <ShieldAlert className="size-3.5 shrink-0" />
    <span className="truncate">
      {attentionLabel(attention)} · {agoLabel(attention.since, now)}
    </span>
  </span>
);

/**
 * La tercera línea de la fila: UN estado, el más importante. Algo urgente o
 * delicado → autorizar algo → «Te toca» → no le llegó → la IA trabajando →
 * quién contestó → nada.
 */
const stateLine = (item: ChatListItem, now: number): ReactNode => {
  if (item.attention && (item.attention.urgent || item.attention.reason === "clinical")) {
    return <AttentionState attention={item.attention} now={now} />;
  }
  if (item.awaitingApproval) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 truncate text-xs font-medium text-(--wa-violet)">
        <ShieldAlert className="size-3.5 shrink-0" />
        <span className="truncate">{APPROVAL_LABEL[item.awaitingApproval] ?? APPROVAL_LABEL.reply}</span>
      </span>
    );
  }
  if (item.attention) return <AttentionState attention={item.attention} now={now} />;
  if (item.lastDirection === "OUTBOUND" && item.lastStatus === "FAILED") {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 truncate text-xs text-(--wa-danger)">
        <Ticks status="FAILED" />
        <span className="truncate">{deliveryLabel("FAILED", item.lastFailedReason).label}</span>
      </span>
    );
  }
  if (isRunLive(item.lastRun)) return <RunStatus run={item.lastRun} compact className="min-w-0" />;
  const reply = item.replyState ? REPLY_LABEL[item.replyState] : undefined;
  if (!reply) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 truncate text-xs text-(--wa-meta)">
      {item.replyState === "you_phone" && <Smartphone className="size-3.5 shrink-0" />}
      <span className="truncate">{reply}</span>
    </span>
  );
};

/**
 * Una fila de la lista de chats, como en WhatsApp: nombre y hora; el último
 * mensaje (o el borrador); y, si hay algo que decir, un solo estado. El modo
 * solo se marca si no es el general. `now`: el reloj de la lista.
 */
const ChatRow = ({
  item,
  active,
  now,
  generalMode,
  onOpen,
}: {
  item: ChatListItem;
  active: boolean;
  now: number;
  generalMode: ChatListItem["aiMode"] | null;
  onOpen: () => void;
}) => {
  const unread = item.unreadCount > 0;
  const state = stateLine(item, now);
  const tag = <ModeTag mode={item.aiMode} generalMode={generalMode} />;
  const showMode = Boolean(generalMode && item.aiMode !== generalMode);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 px-3 text-left transition-colors hover:bg-(--wa-hover)",
        active && "bg-(--wa-active) hover:bg-(--wa-active)"
      )}
    >
      <Avatar name={item.name} />
      <div className="min-w-0 flex-1 border-b border-(--wa-divider) py-3">
        <div className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-[15px] text-(--wa-text)", unread && "font-medium")}>
            {item.name}
          </span>
          <span className={cn("shrink-0 text-xs", unread ? "font-medium text-(--wa-unread)" : "text-(--wa-meta)")}>
            {timeLabel(item.lastMessageAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          {item.draftPreview ? (
            // Como en WhatsApp: lo que quedó escrito a medias se ve en la lista.
            <span className="min-w-0 flex-1 truncate text-sm text-(--wa-meta)">
              <span className="font-medium text-(--wa-accent)">Borrador: </span>
              {item.draftPreview}
            </span>
          ) : (
            <>
              {item.lastDirection === "OUTBOUND" && <Ticks status={item.lastStatus} />}
              <span className="min-w-0 flex-1 truncate text-sm text-(--wa-meta)">
                {item.lastDirection === "OUTBOUND" && item.lastIsAutoReply ? "IA: " : ""}
                {item.lastMessage ?? "📎 Adjunto"}
              </span>
            </>
          )}
          {item.priority && (
            <Star className="size-3.5 shrink-0 fill-(--wa-star) text-(--wa-star)" aria-label="Favorito" />
          )}
          {unread && (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-(--wa-unread) px-1.5 text-[11px] font-semibold text-white">
              {item.unreadCount}
            </span>
          )}
        </div>
        {(state || showMode) && (
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <span className="flex min-w-0 flex-1">{state}</span>
            {tag}
          </div>
        )}
      </div>
    </button>
  );
};

export default ChatRow;
