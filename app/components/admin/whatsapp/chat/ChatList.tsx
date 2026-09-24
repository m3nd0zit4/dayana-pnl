"use client";

import { Loader2, PanelLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatListItem, ChatQueue } from "@/lib/crm/whatsapp-agent/workspace";
import GlobalModeSwitch from "../GlobalModeSwitch";
import ChatRow from "./ChatRow";
import { wa } from "./chatTheme";

export type Counts = { attention: number; mine: number; ai: number; unread: number };

const QUEUES: { id: ChatQueue; label: string; hint: string }[] = [
  { id: "all", label: "Todos", hint: "Todos los chats" },
  { id: "attention", label: "Te toca", hint: "La IA te los pasó" },
  { id: "mine", label: "Tuyos", hint: "Tomados o favoritos: la IA no los toca" },
  { id: "ai", label: "IA", hint: "Los atiende la IA" },
];

/** La columna de la izquierda: buscar, filtrar por quién atiende y la lista. */
const ChatList = ({
  items,
  counts,
  queue,
  q,
  selectedId,
  canLoadMore,
  hidden,
  onQueue,
  onQuery,
  onSearch,
  onOpen,
  onLoadMore,
  onToggleSidebar,
  onModeChanged,
}: {
  items: ChatListItem[] | null;
  counts: Counts;
  queue: ChatQueue;
  q: string;
  selectedId: string | null;
  canLoadMore: boolean;
  /** En el celular, con un chat abierto, la lista se esconde. */
  hidden: boolean;
  onQueue: (id: ChatQueue) => void;
  onQuery: (q: string) => void;
  onSearch: () => void;
  onOpen: (id: string) => void;
  onLoadMore: () => void;
  onToggleSidebar: () => void;
  onModeChanged: () => void;
}) => (
  <div className={cn("flex w-full min-w-0 flex-col bg-(--wa-surface) md:w-[26rem] md:shrink-0", hidden && "hidden md:flex")}>
    <div className="flex h-[60px] items-center gap-2 bg-(--wa-panel) px-2 md:px-3">
      <button
        type="button"
        onClick={onToggleSidebar}
        title="Mostrar u ocultar el menú"
        aria-label="Mostrar u ocultar el menú"
        className={wa.iconButton}
      >
        <PanelLeft className="size-5" />
      </button>
      <h1 className="flex-1 text-lg font-semibold text-(--wa-text)">Chats</h1>
      {counts.unread > 0 && (
        <span className="rounded-full bg-(--wa-unread) px-2 py-0.5 text-xs font-semibold text-white">{counts.unread} sin leer</span>
      )}
    </div>
    <div className="space-y-2 border-b border-(--wa-divider) px-3 py-2">
      <GlobalModeSwitch onChanged={onModeChanged} />
      <div className="flex items-center gap-2 rounded-lg bg-(--wa-panel) px-3">
        <Search className="size-4 shrink-0 text-(--wa-icon)" />
        <input
          value={q}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
          onBlur={onSearch}
          placeholder="Buscar un chat o número"
          aria-label="Buscar un chat o número"
          className="h-10 w-full bg-transparent text-base text-(--wa-text) outline-none placeholder:text-(--wa-meta) md:h-9 md:text-sm"
        />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {QUEUES.map((qq) => {
          const n = qq.id === "attention" ? counts.attention : qq.id === "mine" ? counts.mine : qq.id === "ai" ? counts.ai : null;
          const active = queue === qq.id;
          return (
            <button
              key={qq.id}
              type="button"
              title={qq.hint}
              onClick={() => onQueue(qq.id)}
              aria-pressed={active}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors md:h-8",
                active
                  ? "bg-(--wa-green-soft) text-(--wa-accent)"
                  : "bg-(--wa-panel) text-(--wa-icon) hover:bg-(--wa-divider)"
              )}
            >
              {qq.label}
              {n !== null && n > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[11px]",
                    qq.id === "attention" ? "bg-(--wa-green) text-white" : "bg-(--wa-surface)/80 text-(--wa-icon)"
                  )}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {items === null && (
        <div className="grid place-items-center p-8">
          <Loader2 className="size-5 animate-spin text-(--wa-green)" />
        </div>
      )}
      {items?.length === 0 && (
        <div className="p-8 text-center text-sm text-(--wa-meta)">
          {queue === "attention" ? "Nada pendiente: la IA no te ha pasado ningún chat." : "No hay chats aquí."}
        </div>
      )}
      {items?.map((item) => (
        <ChatRow key={item.id} item={item} active={item.id === selectedId} onOpen={() => onOpen(item.id)} />
      ))}
      {canLoadMore && (
        <div className="flex justify-center p-3">
          <button
            type="button"
            onClick={onLoadMore}
            className="inline-flex h-10 items-center rounded-full bg-(--wa-panel) px-4 text-xs font-medium text-(--wa-icon) hover:bg-(--wa-divider) md:h-8"
          >
            Ver más chats
          </button>
        </div>
      )}
    </div>
  </div>
);

export default ChatList;
