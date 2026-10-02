"use client";

import {
  ArrowLeft,
  Bot,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Hand,
  MoreVertical,
  PanelLeft,
  PanelRight,
  Search,
  ShieldAlert,
  Star,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ChatDetail } from "@/lib/crm/whatsapp-agent/workspace";
import { APPROVAL_LABEL, MODE_LABEL, MODE_SHORT, RunStatus, agoLabel, attentionLabel, isRunLive } from "../status";
import { wa } from "./chatTheme";
import { ActionButton, Avatar } from "./ui";

type Act = (key: string, body: Record<string, unknown>, done?: string) => unknown;

const MODES = ["AUTO", "COPILOT", "MANUAL"] as const;
/** Opciones del menú cómodas con el dedo. */
const ITEM = "min-h-10 gap-2 px-2.5 text-sm";

/**
 * «Te toca» (o algo por autorizar): por qué, y UNA acción, «Listo». Contestar
 * también lo saca de aquí; «Listo» es para lo que se resolvió por otro lado.
 */
const AttentionBar = ({
  chat,
  canWrite,
  busy,
  act,
  now,
}: {
  chat: ChatDetail;
  canWrite: boolean;
  busy: string | null;
  act: Act;
  now: number;
}) => {
  const a = chat.attention;
  const approval = chat.approvals[0]?.proposal.kind ?? null;
  if (!a && !approval) return null;
  const urgent = Boolean(a?.urgent);
  const title = a ? attentionLabel(a) : (APPROVAL_LABEL[approval ?? "reply"] ?? APPROVAL_LABEL.reply);
  // Con una propuesta abajo, el motivo ya lo dice ella: aquí solo desde cuándo.
  const detail = a
    ? [approval ? null : a.detail, a.reason === "unanswered" ? `escribió ${agoLabel(a.since, now)}` : agoLabel(a.since, now)]
        .filter(Boolean)
        .join(" · ")
    : "Acéptalo o cancélalo abajo, o contéstale tú.";
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-(--wa-divider) px-3 py-2 sm:px-4",
        urgent ? "bg-(--wa-danger-soft)" : "bg-(--wa-attention-soft)"
      )}
    >
      <ShieldAlert className={cn("size-5 shrink-0", urgent ? "text-(--wa-danger)" : "text-(--wa-attention)")} />
      <div className="min-w-0 flex-1 leading-snug">
        <div className="truncate text-sm font-medium text-(--wa-text)">{title}</div>
        <div className="line-clamp-2 text-xs text-(--wa-icon)">{detail}</div>
      </div>
      <ActionButton
        tone="primary"
        disabled={!canWrite || busy !== null}
        title="Sale de «Te toca» (no cambia quién responde). Contestar también lo saca."
        onClick={() =>
          act("resolve", { action: "resolve", seenInboundAt: chat.lastInboundAt }, "Listo: salió de «Te toca»")
        }
      >
        <CheckCheck /> Listo
      </ActionButton>
    </div>
  );
};

/** Lo que no se usa a diario: modo, tomar/devolver, favorito, la ficha, lo que sabe la IA. */
const ChatMenu = ({
  chat,
  canWrite,
  busy,
  act,
  onToggleInfo,
}: {
  chat: ChatDetail;
  canWrite: boolean;
  busy: string | null;
  act: Act;
  onToggleInfo: () => void;
}) => {
  const mine = chat.aiMode === "MANUAL" || chat.priority;
  const disabled = !canWrite || busy !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={wa.iconButton} aria-label="Más opciones del chat" title="Más opciones">
        <MoreVertical className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Quién responde aquí</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={chat.aiMode}
            onValueChange={(mode) =>
              act("mode", { action: "mode", mode }, MODE_LABEL[mode as (typeof MODES)[number]])
            }
          >
            {MODES.map((m) => (
              <DropdownMenuRadioItem key={m} value={m} disabled={disabled} className={ITEM}>
                <span>
                  <span className="font-medium">{MODE_SHORT[m]}</span>
                  <span className="text-muted-foreground"> · {MODE_LABEL[m].split(": ")[1]}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {mine ? (
          <DropdownMenuItem
            className={ITEM}
            disabled={disabled}
            onClick={() => act("release", { action: "release" }, "La IA vuelve a atender este chat")}
          >
            <Bot /> Devolver a la IA
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            className={ITEM}
            disabled={disabled}
            onClick={() => act("take", { action: "take" }, "Modo Yo: la IA no escribe aquí")}
          >
            <Hand /> Tomar chat
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className={ITEM}
          disabled={disabled}
          onClick={() =>
            act(
              "priority",
              { action: "priority", on: !chat.priority },
              chat.priority ? "Ya no es favorito" : "Favorito: la IA no toca este chat"
            )
          }
        >
          <Star /> {chat.priority ? "Quitar de favoritos" : "Marcar como favorito"}
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} onClick={onToggleInfo}>
          <PanelRight /> Lo que sabe la IA
        </DropdownMenuItem>
        {chat.contactId && (
          <DropdownMenuItem className={ITEM} render={<Link href={`/admin/contacts/${chat.contactId}`} />}>
            <UserRound /> Ver ficha
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** Buscar dentro del chat: resalta y salta entre coincidencias. */
export const ChatSearchBar = ({
  query,
  onQuery,
  current,
  total,
  onStep,
  onClose,
}: {
  query: string;
  onQuery: (q: string) => void;
  current: number;
  total: number;
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
}) => {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="flex items-center gap-1 border-b border-(--wa-divider) bg-(--wa-surface) px-2 py-1" role="search">
      <Search className="ml-1 size-4 shrink-0 text-(--wa-icon)" />
      <input
        ref={input}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") onClose();
        }}
        placeholder="Buscar en este chat"
        aria-label="Buscar en este chat"
        className="h-10 min-w-0 flex-1 bg-transparent px-1 text-base text-(--wa-text) outline-none placeholder:text-(--wa-meta) md:text-sm"
      />
      <span className="shrink-0 text-xs tabular-nums text-(--wa-meta)" aria-live="polite">
        {query.trim() ? (total ? `${current + 1} de ${total}` : "Sin resultados") : ""}
      </span>
      <button type="button" className={wa.iconButton} onClick={() => onStep(-1)} disabled={!total} aria-label="Coincidencia anterior" title="Anterior (Shift+Enter)">
        <ChevronUp className="size-5" />
      </button>
      <button type="button" className={wa.iconButton} onClick={() => onStep(1)} disabled={!total} aria-label="Coincidencia siguiente" title="Siguiente (Enter)">
        <ChevronDown className="size-5" />
      </button>
      <button type="button" className={wa.iconButton} onClick={onClose} aria-label="Cerrar búsqueda">
        <X className="size-5" />
      </button>
    </div>
  );
};

/**
 * Cabecera del chat (como la de WhatsApp): nombre, buscar y «⋯». Debajo, una
 * sola barra: «Te toca» con «Listo» si le toca, o lo que hace la IA si no.
 */
const ChatHeader = ({
  chat,
  canWrite,
  busy,
  act,
  now,
  onBack,
  onToggleSidebar,
  showInfo,
  onToggleInfo,
  searchOpen,
  onToggleSearch,
}: {
  chat: ChatDetail;
  canWrite: boolean;
  busy: string | null;
  act: Act;
  /** El reloj del chat abierto (avanza solo), para «escribió hace 5 min». */
  now: number;
  onBack: () => void;
  onToggleSidebar: () => void;
  showInfo: boolean;
  onToggleInfo: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
}) => {
  const lastRun = chat.runs[0] ?? null;
  const live = isRunLive(lastRun);
  const needsYou = Boolean(chat.attention || chat.approvals.length > 0);
  return (
    <>
      <div className="flex h-[60px] items-center gap-1 border-l border-(--wa-border) bg-(--wa-panel) px-1 sm:px-3 md:gap-2">
        <button type="button" className={cn(wa.iconButton, "md:hidden")} onClick={onBack} aria-label="Volver">
          <ArrowLeft className="size-5" />
        </button>
        <button
          type="button"
          className={cn(wa.iconButton, "hidden md:grid")}
          onClick={onToggleSidebar}
          title="Mostrar u ocultar el menú"
          aria-label="Mostrar u ocultar el menú"
        >
          <PanelLeft className="size-5" />
        </button>
        <Avatar name={chat.name} size={40} />
        <div className="min-w-0 flex-1 pl-1">
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate text-base text-(--wa-text)">{chat.name}</span>
            {chat.priority && <Star className="size-3.5 shrink-0 fill-(--wa-star) text-(--wa-star)" aria-label="Favorito" />}
          </div>
          <div className="truncate text-xs text-(--wa-meta)">
            {/^\d+$/.test(chat.phone) ? `+${chat.phone}` : "Escribe con usuario (sin número visible)"}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleSearch}
          title="Buscar en este chat"
          aria-label="Buscar en este chat"
          aria-pressed={searchOpen}
          className={cn(wa.iconButton, searchOpen && "bg-(--wa-text)/5")}
        >
          <Search className="size-5" />
        </button>
        <button
          type="button"
          onClick={onToggleInfo}
          title="Lo que sabe la IA de este chat"
          aria-label="Lo que sabe la IA de este chat"
          aria-pressed={showInfo}
          className={cn(wa.iconButton, "hidden md:grid", showInfo && "bg-(--wa-text)/5")}
        >
          <PanelRight className="size-5" />
        </button>
        <ChatMenu chat={chat} canWrite={canWrite} busy={busy} act={act} onToggleInfo={onToggleInfo} />
      </div>

      {needsYou ? (
        <AttentionBar chat={chat} canWrite={canWrite} busy={busy} act={act} now={now} />
      ) : (
        <div className="flex min-w-0 items-center gap-2 border-b border-(--wa-divider) bg-(--wa-surface) px-4 py-1.5">
          {lastRun ? (
            <RunStatus run={lastRun} className={cn("min-w-0", live && "font-medium")} />
          ) : (
            <span className="text-xs text-(--wa-meta)">La IA aún no ha mirado este chat.</span>
          )}
          <span className="ml-auto shrink-0 text-xs text-(--wa-meta)">
            {chat.priority ? "Favorito: la IA no lo toca" : `Modo ${MODE_SHORT[chat.aiMode]}`}
            {chat.paused && !chat.priority ? " · en pausa" : ""}
          </span>
        </div>
      )}
    </>
  );
};

export default ChatHeader;
