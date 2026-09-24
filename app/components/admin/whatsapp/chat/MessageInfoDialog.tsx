"use client";

import { Check, CheckCheck, Loader2, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { deliveryLabel } from "@/lib/crm/whatsapp-delivery-labels";
import type { MessageInfo } from "@/lib/crm/whatsapp-message-actions";
import { wa } from "./chatTheme";
import { quotePreview } from "@/lib/crm/whatsapp-chat-format";
import type { ChatMessage } from "./utils";

type Step = { status: string; at: string | null; detail?: string | null };

/** El orden de la línea de tiempo: enviado → le llegó → lo leyó (o no le llegó). */
const ORDER = ["SENT", "DELIVERED", "READ", "FAILED"];

/**
 * Pasos a mostrar: el historial de acuses de WhatsApp y, si falta alguno
 * (mensajes de antes del historial), las horas guardadas en el propio mensaje.
 */
const stepsFor = (info: MessageInfo): Step[] => {
  const byStatus = new Map<string, Step>();
  for (const e of info.events) {
    byStatus.set(e.status, {
      status: e.status,
      at: e.at,
      detail: e.status === "FAILED" ? (e.errorTitle ?? info.failedReason) : null,
    });
  }
  if (!byStatus.has("SENT")) byStatus.set("SENT", { status: "SENT", at: info.sentAt });
  if (info.deliveredAt && !byStatus.has("DELIVERED")) byStatus.set("DELIVERED", { status: "DELIVERED", at: info.deliveredAt });
  if (info.readAt && !byStatus.has("READ")) byStatus.set("READ", { status: "READ", at: info.readAt });
  if (info.status === "FAILED" && !byStatus.has("FAILED")) {
    byStatus.set("FAILED", { status: "FAILED", at: null, detail: info.failedReason });
  }
  return [...byStatus.values()]
    .filter((s) => ORDER.includes(s.status))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
};

/** «Enviado» en la línea de tiempo; el resto con las mismas palabras de todo el CRM. */
const stepLabel = (s: Step) => (s.status === "SENT" ? "Enviado" : deliveryLabel(s.status, s.detail).label);

const stepIcon = (status: string) =>
  status === "FAILED" ? (
    <XCircle className="size-5 text-(--wa-danger)" />
  ) : status === "READ" ? (
    <CheckCheck className="size-5 text-(--wa-read)" />
  ) : status === "DELIVERED" ? (
    <CheckCheck className="size-5 text-(--wa-tick)" />
  ) : (
    <Check className="size-5 text-(--wa-tick)" />
  );

const when = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** «Info del mensaje»: cuándo salió, cuándo le llegó y cuándo lo leyó. */
const MessageInfoDialog = ({ message, onClose }: { message: ChatMessage; onClose: () => void }) => {
  const [info, setInfo] = useState<MessageInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/whatsapp/messages/${message.id}/info`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = (await res.json()) as MessageInfo;
        if (alive) setInfo(data);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [message.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wa-msg-info-title"
        className="w-full max-w-sm overflow-hidden rounded-xl bg-(--wa-surface) text-(--wa-text) shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 bg-(--wa-panel) px-2 py-1.5">
          <button type="button" onClick={onClose} className={wa.iconButton} aria-label="Cerrar">
            <X className="size-5" />
          </button>
          <h2 id="wa-msg-info-title" className="text-base font-medium">
            Info del mensaje
          </h2>
        </div>
        <div className="bg-(--wa-chat-bg) px-4 py-3">
          <div className={cn("ml-auto max-w-[85%] rounded-lg rounded-tr-none px-2.5 py-1.5 text-sm", wa.bubbleOut, wa.bubbleShadow)}>
            <span className="line-clamp-4 break-words whitespace-pre-wrap">{quotePreview(message)}</span>
          </div>
        </div>
        <div className="px-4 py-3">
          {!info && !error && (
            <div className="grid place-items-center py-4">
              <Loader2 className="size-5 animate-spin text-(--wa-green)" />
            </div>
          )}
          {error && <p className="py-2 text-sm text-(--wa-danger)">No se pudo cargar la info del mensaje.</p>}
          {info && (
            <ol className="space-y-3">
              {stepsFor(info).map((s) => (
                <li key={s.status} className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0">{stepIcon(s.status)}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm font-medium", s.status === "FAILED" && "text-(--wa-danger)")}>
                      {stepLabel(s)}
                    </span>
                    <span className="block text-xs text-(--wa-meta)">{s.at ? when(s.at) : "—"}</span>
                  </span>
                </li>
              ))}
              {info.status !== "FAILED" && !info.deliveredAt && !info.events.some((e) => e.status === "DELIVERED") && (
                <li className="text-xs text-(--wa-meta)">WhatsApp aún no confirma que le llegó.</li>
              )}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageInfoDialog;
