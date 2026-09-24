"use client";

import { Check, CheckCheck, UserRound, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { highlightParts } from "@/lib/crm/whatsapp-chat-format";
import type { ChatListItem } from "@/lib/crm/whatsapp-agent/workspace";
import { wa } from "./chatTheme";
import { initials, linkKind } from "./utils";

const URL_SPLIT = /(https?:\/\/[^\s]+)/g;
const IS_URL = /^https?:\/\//;

/** Texto con la búsqueda resaltada. */
export const Highlighted = ({ text, query }: { text: string; query?: string }) =>
  query?.trim() ? (
    <>
      {highlightParts(text, query).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-(--wa-highlight) text-inherit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  ) : (
    <>{text}</>
  );

/** Texto con los enlaces tocables, como en WhatsApp. */
export const Linkified = ({ text, query }: { text: string; query?: string }) => (
  <>
    {text.split(URL_SPLIT).map((part, i) =>
      IS_URL.test(part) ? (
        linkKind(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "my-0.5 inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
              wa.primary
            )}
          >
            {linkKind(part)}
          </a>
        ) : (
          <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all text-(--wa-link) hover:underline">
            <Highlighted text={part} query={query} />
          </a>
        )
      ) : (
        <Highlighted key={i} text={part} query={query} />
      )
    )}
  </>
);

/** ✓ enviado · ✓✓ le llegó · ✓✓ azul lo leyó · ✕ no le llegó (como WhatsApp). */
export const Ticks = ({ status }: { status: string | null }) =>
  status === "FAILED" ? (
    <XCircle className="size-4 shrink-0 text-(--wa-danger)" aria-label="No le llegó" />
  ) : status === "READ" ? (
    <CheckCheck className="size-4 shrink-0 text-(--wa-read)" aria-label="Lo leyó" />
  ) : status === "DELIVERED" ? (
    <CheckCheck className="size-4 shrink-0 text-(--wa-tick)" aria-label="Le llegó" />
  ) : (
    <Check className="size-4 shrink-0 text-(--wa-tick)" aria-label="Enviado" />
  );

export const Avatar = ({ name, size = 49 }: { name: string; size?: number }) => (
  <span
    className="grid shrink-0 place-items-center rounded-full bg-(--wa-avatar) text-sm font-medium text-(--wa-icon)"
    style={{ width: size, height: size }}
  >
    {/^\+?\d/.test(name) ? <UserRound className="size-6" /> : initials(name)}
  </span>
);

/** Etiqueta pequeña de quién atiende el chat, como las etiquetas de WhatsApp Business. */
export const HandlerTag = ({ item }: { item: Pick<ChatListItem, "aiMode" | "paused" | "priority"> }) => {
  const [label, cls] = item.priority
    ? ["⭐ Favorito", "bg-(--wa-panel) text-(--wa-text)"]
    : item.aiMode === "MANUAL"
      ? ["Tú", "bg-(--wa-blue-soft) text-(--wa-blue)"]
      : item.aiMode === "COPILOT"
        ? ["Copiloto", "bg-(--wa-violet-soft) text-(--wa-violet)"]
        : item.paused
          ? ["IA en pausa", "bg-(--wa-panel) text-(--wa-icon)"]
          : ["IA", "bg-(--wa-green-soft) text-(--wa-green-ink)"];
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", cls)}>{label}</span>;
};

/** Botón claro y visible, en la paleta de WhatsApp (40 px en el celular). */
export const ActionButton = ({
  children,
  onClick,
  disabled,
  tone = "outline",
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "outline" | "danger";
  title?: string;
}) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    disabled={disabled}
    className={cn(
      "inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors disabled:opacity-50 md:h-9 [&_svg]:size-4",
      tone === "primary" && wa.primary,
      tone === "outline" && wa.outline,
      tone === "danger" && wa.danger
    )}
  >
    {children}
  </button>
);
