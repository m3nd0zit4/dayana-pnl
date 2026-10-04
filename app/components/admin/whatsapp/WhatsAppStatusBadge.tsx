"use client";

import { Check, CheckCheck, MessageCircleReply, XCircle } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { personStatusLine, shortWhen } from "@/lib/crm/whatsapp-delivery-labels";
import type { WhatsAppStatus } from "@/lib/crm/whatsapp-outbound";

/**
 * El estado de WhatsApp de una persona, como en WhatsApp: ✓ enviado, ✓✓
 * entregado, ✓✓ azul leído, 💬 respondió. Toca y abre su chat.
 *
 * Siempre en una línea («Le llegó · 3 oct, 9:15 p. m.»): la etiqueta entera y
 * la hora, atenuada, se corta con «…» si no cabe (completa en el `title`).
 *
 * `pending`: el estado todavía no se sabe («loading») o no se pudo pedir
 * («error»). No es lo mismo que «Sin WhatsApp», que afirma que nunca se le
 * escribió: decirlo mientras carga hacía creer que nadie tenía WhatsApp.
 */
const WhatsAppStatusBadge = ({
  status,
  compact,
  pending,
  timeZone,
}: {
  status: WhatsAppStatus | null | undefined;
  compact?: boolean;
  pending?: "loading" | "error";
  /** Zona de la hora. Obligatoria si se pinta en el servidor: si no, la del navegador. */
  timeZone?: string;
}) => {
  const line = personStatusLine(status);
  if (!line) {
    if (pending === "loading") return <span className="text-xs text-muted-foreground">Cargando…</span>;
    if (pending === "error") {
      return (
        <span className="text-xs text-muted-foreground" title="No se pudo cargar el estado de WhatsApp">
          —
        </span>
      );
    }
    return <span className="text-xs text-muted-foreground">{compact ? "—" : "Sin WhatsApp"}</span>;
  }
  // Tokens del CRM (vive fuera del chat): los grises de WhatsApp no se leían en
  // modo oscuro. Solo el azul de «leído» es el de WhatsApp, en los dos temas.
  const iconCls = "size-3.5 shrink-0";
  const [icon, cls] =
    line.tone === "answered"
      ? [<MessageCircleReply key="a" aria-hidden className={iconCls} />, "text-success font-medium"]
      : line.tone === "read"
        ? [<CheckCheck key="r" aria-hidden className={cn(iconCls, "text-[#53bdeb]")} />, "text-muted-foreground"]
        : line.tone === "ok"
          ? [<CheckCheck key="d" aria-hidden className={iconCls} />, "text-muted-foreground"]
          : line.tone === "fail"
            ? [<XCircle key="f" aria-hidden className={iconCls} />, "text-destructive"]
            : [<Check key="s" aria-hidden className={iconCls} />, "text-muted-foreground"];
  const when = shortWhen(line.at, timeZone);
  const content = (
    <span
      className={cn("inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden text-xs whitespace-nowrap", cls)}
      title={`${line.label} · ${when}`}
      // El formato de hora puede variar un espacio entre el ICU del servidor y
      // el del navegador; la zona ya es la misma.
      suppressHydrationWarning
    >
      {icon}
      <span className="shrink-0">{line.label}</span>
      {!compact && (
        <span className="min-w-0 truncate font-normal text-muted-foreground" suppressHydrationWarning>
          · {when}
        </span>
      )}
    </span>
  );
  return status?.conversationId ? (
    <Link
      href={`/admin/whatsapp?conversation=${status.conversationId}`}
      className="inline-flex max-w-full min-w-0 hover:underline"
    >
      {content}
    </Link>
  ) : (
    content
  );
};

export default WhatsAppStatusBadge;
