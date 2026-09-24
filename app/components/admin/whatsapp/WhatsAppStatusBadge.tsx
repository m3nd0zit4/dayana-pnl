"use client";

import { Check, CheckCheck, MessageCircleReply, XCircle } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { deliveryLabel } from "@/lib/crm/whatsapp-delivery-labels";
import type { WhatsAppStatus } from "@/lib/crm/whatsapp-outbound";

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * El estado de WhatsApp de una persona, como en WhatsApp: ✓ enviado, ✓✓
 * entregado, ✓✓ azul leído, 💬 respondió. Toca y abre su chat.
 */
const WhatsAppStatusBadge = ({ status, compact }: { status: WhatsAppStatus | null | undefined; compact?: boolean }) => {
  if (!status?.lastSentAt) {
    return <span className="text-xs text-[#8696a0]">{compact ? "—" : "Sin WhatsApp"}</span>;
  }
  const answered = Boolean(status.answeredAt);
  const s = status.lastStatus;
  const [icon, label, cls] = answered
    ? [<MessageCircleReply key="a" className="size-3.5" />, "Respondió", "text-[#008069] font-medium"]
    : s === "READ"
      ? [<CheckCheck key="r" className="size-3.5 text-[#53bdeb]" />, deliveryLabel(s).label, "text-[#54656f]"]
      : s === "DELIVERED"
        ? [<CheckCheck key="d" className="size-3.5" />, deliveryLabel(s).label, "text-[#54656f]"]
        : s === "FAILED"
          ? [<XCircle key="f" className="size-3.5" />, "No le llegó", "text-[#d92d20]"]
          : [<Check key="s" className="size-3.5" />, deliveryLabel(s).label, "text-[#54656f]"];
  const when = answered ? status.answeredAt! : status.lastSentAt;
  const content = (
    <span className={cn("inline-flex items-center gap-1 text-xs", cls)} title={`${label} · ${dateLabel(when)}`}>
      {icon}
      {label}
      {!compact && <span className="text-[#8696a0]">· {dateLabel(when)}</span>}
    </span>
  );
  return status.conversationId ? (
    <Link href={`/admin/whatsapp?conversation=${status.conversationId}`} className="hover:underline">
      {content}
    </Link>
  ) : (
    content
  );
};

export default WhatsAppStatusBadge;
