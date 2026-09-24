"use client";

import {
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronUp,
  Hand,
  PanelLeft,
  PanelRight,
  RotateCcw,
  Search,
  ShieldAlert,
  Star,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { ChatDetail } from "@/lib/crm/whatsapp-agent/workspace";
import { CATEGORY_LABEL, MODE_LABEL, RunStatus, isRunLive } from "../status";
import { wa } from "./chatTheme";
import { ActionButton, Avatar } from "./ui";

type Act = (key: string, body: Record<string, unknown>, done?: string) => unknown;

const ModeSwitch = ({
  mode,
  disabled,
  onChange,
}: {
  mode: ChatDetail["aiMode"];
  disabled: boolean;
  onChange: (mode: ChatDetail["aiMode"]) => void;
}) => (
  <div
    className="inline-flex h-11 items-center rounded-full border border-(--wa-border) bg-(--wa-surface) p-0.5 md:h-9"
    role="radiogroup"
    aria-label="Quién responde"
  >
    {(["AUTO", "COPILOT", "MANUAL"] as const).map((m) => (
      <button
        key={m}
        type="button"
        role="radio"
        aria-checked={mode === m}
        disabled={disabled}
        onClick={() => onChange(m)}
        title={MODE_LABEL[m]}
        className={cn(
          "h-10 rounded-full px-3 text-sm font-medium transition-colors md:h-8",
          mode === m ? "bg-(--wa-green) text-white" : "text-(--wa-icon) hover:text-(--wa-text)"
        )}
      >
        {m === "AUTO" ? "IA" : m === "COPILOT" ? "Copiloto" : "Yo"}
      </button>
    ))}
  </div>
);

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

/** Cabecera del chat (como la de WhatsApp Web) y la línea de lo que hace la IA. */
const ChatHeader = ({
  chat,
  canWrite,
  busy,
  act,
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
  onBack: () => void;
  onToggleSidebar: () => void;
  showInfo: boolean;
  onToggleInfo: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
}) => {
  const mine = chat.aiMode === "MANUAL" || chat.priority;
  const lastRun = chat.runs[0] ?? null;
  const live = isRunLive(lastRun);
  return (
    <>
      <div className="flex min-h-[60px] flex-wrap items-center gap-x-1 gap-y-1.5 border-l border-(--wa-border) bg-(--wa-panel) px-1 py-2 sm:px-3 md:gap-x-2">
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
          <div className="truncate text-base text-(--wa-text)">{chat.name}</div>
          <div className="flex min-w-0 items-center gap-2 text-xs text-(--wa-meta)">
            <span className="truncate">{/^\d+$/.test(chat.phone) ? `+${chat.phone}` : "Escribe con usuario (sin número visible)"}</span>
            {chat.contactId && (
              <Link href={`/admin/contacts/${chat.contactId}`} className="shrink-0 font-medium text-(--wa-accent) hover:underline">
                Ver ficha
              </Link>
            )}
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
          onClick={() =>
            act("priority", { action: "priority", on: !chat.priority }, chat.priority ? "Ya no es favorito" : "Favorito: la IA no toca este chat")
          }
          disabled={!canWrite}
          title={chat.priority ? "Quitar de favoritos" : "Favorito: la IA no lo toca"}
          aria-label={chat.priority ? "Quitar de favoritos" : "Marcar como favorito"}
          className={wa.iconButton}
        >
          <Star className={cn("size-5", chat.priority && "fill-(--wa-star) text-(--wa-star)")} />
        </button>
        <button
          type="button"
          onClick={onToggleInfo}
          title="Lo que sabe la IA de este chat"
          aria-label="Lo que sabe la IA de este chat"
          aria-pressed={showInfo}
          className={cn(wa.iconButton, showInfo && "bg-(--wa-text)/5")}
        >
          <PanelRight className="size-5" />
        </button>
        {/* Hasta pantallas muy anchas van en su propia fila: el nombre no se corta. */}
        <div className="order-last flex w-full items-center justify-between gap-2 px-1 2xl:order-none 2xl:w-auto 2xl:justify-start 2xl:px-0">
          <ModeSwitch
            mode={chat.aiMode}
            disabled={!canWrite || busy !== null}
            onChange={(mode) => act("mode", { action: "mode", mode }, MODE_LABEL[mode])}
          />
          {mine ? (
            <ActionButton
              tone="outline"
              disabled={!canWrite || busy !== null}
              onClick={() => act("release", { action: "release" }, "La IA vuelve a atender este chat")}
            >
              <Bot /> <span className="hidden sm:inline">Devolver a la IA</span>
              <span className="sm:hidden">A la IA</span>
            </ActionButton>
          ) : (
            <ActionButton
              tone="primary"
              disabled={!canWrite || busy !== null}
              onClick={() => act("take", { action: "take" }, "Chat tuyo: la IA no escribe aquí")}
            >
              <Hand /> Tomar chat
            </ActionButton>
          )}
        </div>
      </div>

      {/* Qué está haciendo la IA aquí */}
      {chat.escalation ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-(--wa-divider) bg-(--wa-surface) px-4 py-2.5 text-sm">
          <ShieldAlert
            className={cn("size-5 shrink-0", chat.escalation.severity === "urgent" ? "text-(--wa-danger)" : "text-(--wa-accent)")}
          />
          <span className="min-w-0 flex-1 text-(--wa-text)">
            <strong>
              {chat.escalation.severity === "urgent" ? "Urgente — " : "Te toca — "}
              {CATEGORY_LABEL[chat.escalation.category ?? ""] ?? "revisar"}.
            </strong>{" "}
            <span className="text-(--wa-icon)">{chat.escalation.reason}</span>
          </span>
          <ActionButton
            tone="primary"
            disabled={!canWrite || busy !== null}
            onClick={() => act("resume", { action: "resume" }, "La IA vuelve a responder aquí")}
          >
            <RotateCcw /> Listo, que siga la IA
          </ActionButton>
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-2 border-b border-(--wa-divider) bg-(--wa-surface) px-4 py-1.5">
          {lastRun ? (
            <RunStatus run={lastRun} className={cn("min-w-0", live && "font-medium")} />
          ) : (
            <span className="text-xs text-(--wa-meta)">La IA aún no ha mirado este chat.</span>
          )}
          <span className="ml-auto shrink-0 text-xs text-(--wa-meta)">
            {chat.priority ? "Favorito: la IA no lo toca" : MODE_LABEL[chat.aiMode]}
            {chat.paused && !chat.priority ? " · en pausa" : ""}
          </span>
        </div>
      )}
    </>
  );
};

export default ChatHeader;
