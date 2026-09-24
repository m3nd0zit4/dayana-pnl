"use client";

import { Bot, Loader2, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { WhatsAppStatus } from "@/lib/crm/whatsapp-outbound";
import { contactPresets } from "@/lib/crm/whatsapp-presets";
import { SendWhatsAppButton } from "./SendWhatsAppDialog";
import WhatsAppStatusBadge from "./WhatsAppStatusBadge";

type Msg = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string | null;
  sentAt: string;
  status: string;
  isAutoReply: boolean;
  attachments: { kind: string }[];
};

/**
 * WhatsApp dentro de la ficha del contacto: si le escribimos, si le llegó, si
 * lo leyó y si respondió; los últimos mensajes del chat, y un botón para
 * escribirle sin salir de la ficha.
 */
const ContactWhatsAppPanel = ({ contactId, name, hasPhone }: { contactId: string; name: string; hasPhone: boolean }) => {
  const [status, setStatus] = useState<WhatsAppStatus | null | undefined>(undefined);
  const [messages, setMessages] = useState<Msg[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/whatsapp/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: [contactId] }),
    }).catch(() => null);
    const s = res?.ok ? ((await res.json()) as { statuses: Record<string, WhatsAppStatus> }).statuses[contactId] : null;
    setStatus(s ?? null);
    if (s?.conversationId) {
      const chat = await fetch(`/api/admin/whatsapp/chats/${s.conversationId}`, { cache: "no-store" }).catch(() => null);
      if (chat?.ok) setMessages(((await chat.json()) as { messages: Msg[] }).messages.slice(-12));
      else setMessages([]);
    } else {
      setMessages([]);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {hasPhone ? (
          <SendWhatsAppButton contactId={contactId} name={name} presets={contactPresets()} source="perfil" onSent={load} />
        ) : (
          <span className="text-sm text-muted-foreground">Agrega su número de WhatsApp para poder escribirle.</span>
        )}
        {status === undefined ? <Loader2 className="size-4 animate-spin text-[#00a884]" /> : <WhatsAppStatusBadge status={status} />}
        {status?.conversationId && (
          <Link
            href={`/admin/whatsapp?conversation=${status.conversationId}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-[#008069] hover:underline"
          >
            <MessageCircle className="size-4" /> Abrir el chat
          </Link>
        )}
      </div>

      {messages && messages.length > 0 && (
        <div className="space-y-1.5 rounded-xl bg-[#efeae2] p-3 dark:bg-muted/30">
          {messages.map((m) => {
            const out = m.direction === "OUTBOUND";
            return (
              <div key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm",
                    out ? "bg-[#d9fdd3]" : "bg-white",
                    m.status === "FAILED" && "ring-1 ring-[#d92d20]"
                  )}
                >
                  {m.isAutoReply && (
                    <div className="flex items-center gap-1 text-[11px] font-semibold text-[#008069]">
                      <Bot className="size-3" /> IA
                    </div>
                  )}
                  <p className="whitespace-pre-wrap break-words text-[#111b21]">
                    {m.body || (m.attachments[0] ? `📎 ${m.attachments[0].kind}` : "")}
                  </p>
                  <div className="text-right text-[10px] text-[#667781]">
                    {new Date(m.sentAt).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {messages && messages.length === 0 && status !== undefined && (
        <p className="text-sm text-muted-foreground">Todavía no hay mensajes de WhatsApp con esta persona.</p>
      )}
    </div>
  );
};

export default ContactWhatsAppPanel;
