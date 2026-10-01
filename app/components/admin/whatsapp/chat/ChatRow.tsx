"use client";

import { CheckCheck, ShieldAlert, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { deliveryLabel } from "@/lib/crm/whatsapp-delivery-labels";
import type { ChatListItem } from "@/lib/crm/whatsapp-agent/workspace";
import { resolvedLabel } from "@/lib/crm/whatsapp-pending-rules";
import { CATEGORY_LABEL, RunStatus, agoLabel, isRunLive } from "../status";
import { Avatar, HandlerTag, Ticks } from "./ui";
import { timeLabel } from "./utils";

const REPLY_LABEL: Record<NonNullable<ChatListItem["replyState"]>, string> = {
  unanswered: "Sin responder",
  you: "Respondiste",
  you_phone: "Respondiste desde el celular",
  ai: "Respondió la IA",
  auto: "Mensaje automático enviado",
};

/** Pendiente: quién contestó lo último (responder no lo saca de pendientes). */
const PendingLine = ({ item, now }: { item: ChatListItem; now: number }) => {
  const unanswered = item.replyState === "unanswered" || item.replyState === null;
  return (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-xs",
        unanswered ? "font-medium text-(--wa-pending)" : "text-(--wa-meta)"
      )}
    >
      {REPLY_LABEL[item.replyState ?? "unanswered"]}
      {unanswered && item.pendingSince ? ` · ${agoLabel(item.pendingSince, now)}` : ""}
    </span>
  );
};

/** Una fila de la lista de chats, como en WhatsApp Web. `now`: el reloj de la lista. */
const ChatRow = ({
  item,
  active,
  now,
  onOpen,
}: {
  item: ChatListItem;
  active: boolean;
  now: number;
  onOpen: () => void;
}) => {
  const urgent = item.escalation?.severity === "urgent";
  const unread = item.unreadCount > 0;
  const live = isRunLive(item.lastRun);
  const failed = item.lastDirection === "OUTBOUND" && item.lastStatus === "FAILED";
  // Atendido por una cita o un pago: vale la pena decirlo (a mano, no).
  const resolvedBy =
    !item.pending && (item.resolvedReason === "appointment" || item.resolvedReason === "payment")
      ? resolvedLabel(item.resolvedReason)
      : null;
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
          {item.pending && (
            <span role="img" aria-label="Pendiente" title="Pendiente" className="size-2.5 shrink-0 rounded-full bg-(--wa-pending)" />
          )}
          <span className="min-w-0 flex-1 truncate text-[15px] text-(--wa-text)">{item.name}</span>
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
          {item.priority && <Star className="size-3.5 shrink-0 fill-(--wa-star) text-(--wa-star)" />}
          {unread && (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-(--wa-unread) px-1.5 text-[11px] font-semibold text-white">
              {item.unreadCount}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          {item.awaitingApproval ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-(--wa-violet)">
              <ShieldAlert className="size-3.5" />
              {item.awaitingApproval === "booking"
                ? "Autoriza la cita"
                : item.awaitingApproval === "payment_link"
                  ? "Autoriza el enlace de pago"
                  : item.awaitingApproval === "payment_received"
                    ? "Confirma el pago"
                    : "Borrador por aprobar"}
            </span>
          ) : item.escalation ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-medium",
                urgent ? "text-(--wa-danger)" : "text-(--wa-accent)"
              )}
            >
              <ShieldAlert className="size-3.5" />
              {urgent ? "Urgente · " : "Te toca · "}
              {CATEGORY_LABEL[item.escalation.category ?? ""] ?? "revisar"}
            </span>
          ) : !live && (failed || (item.lastDirection === "OUTBOUND" && !item.pending && !resolvedBy)) ? (
            // Lo último fue nuestro: manda el estado de ESE mensaje (igual que en el chat).
            // Un fallo se ve siempre, aunque el chat esté pendiente.
            <span
              className={cn(
                "inline-flex min-w-0 flex-1 items-center gap-1 truncate text-xs",
                failed ? "text-(--wa-danger)" : "text-(--wa-meta)"
              )}
            >
              <Ticks status={item.lastStatus} />
              <span className="truncate">{deliveryLabel(item.lastStatus, item.lastFailedReason).label}</span>
            </span>
          ) : item.pending && !live ? (
            <PendingLine item={item} now={now} />
          ) : resolvedBy && !live ? (
            <span className="inline-flex min-w-0 flex-1 items-center gap-1 truncate text-xs text-(--wa-meta)">
              <CheckCheck className="size-3.5 shrink-0" />
              <span className="truncate">Atendido · {resolvedBy}</span>
            </span>
          ) : (
            <RunStatus run={item.lastRun} compact className="min-w-0 flex-1" />
          )}
          <span className="ml-auto" />
          <HandlerTag item={item} />
        </div>
      </div>
    </button>
  );
};

export default ChatRow;
