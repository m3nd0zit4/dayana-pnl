"use client";

import { Loader2, PanelLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatListItem, ChatQueue } from "@/lib/crm/whatsapp-agent/workspace";
import GlobalModeSwitch from "../GlobalModeSwitch";
import ChatRow from "./ChatRow";
import { wa } from "./chatTheme";

export type Counts = { attention: number; seguimiento: number; mine: number; ai: number; unread: number };

type Tab = "attention" | "all" | "seguimiento";

const TABS: { id: Tab; label: string; hint: string }[] = [
  {
    id: "attention",
    label: "Te toca",
    hint: "Lo que necesita que contestes. Sale en cuanto respondes (aquí o desde el celular) o pulsas «Listo».",
  },
  { id: "all", label: "Todos", hint: "Todos los chats" },
  {
    id: "seguimiento",
    label: "Seguimiento",
    hint: "Escribieron, llevan más de 2 días quietos y no han agendado ni pagado.",
  },
];

/** Dentro de «Todos»: quién responde cada chat. */
const MODE_FILTERS: { id: "all" | "ai" | "mine"; label: string; hint: string }[] = [
  { id: "all", label: "Cualquiera", hint: "Todos los chats" },
  { id: "ai", label: "IA", hint: "Los lleva la IA (sola o en copiloto)" },
  { id: "mine", label: "Yo", hint: "En modo Yo o favoritos ⭐: la IA no los toca" },
];

export const tabOf = (queue: ChatQueue): Tab =>
  queue === "attention" || queue === "seguimiento" ? queue : "all";

const chip = (active: boolean) =>
  cn(
    "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors md:h-8",
    active ? "bg-(--wa-green-soft) text-(--wa-accent)" : "bg-(--wa-panel) text-(--wa-icon) hover:bg-(--wa-divider)"
  );

const Empty = ({ queue, q }: { queue: ChatQueue; q: string }) => {
  if (q.trim()) {
    return <div className="p-8 text-center text-sm text-(--wa-meta)">Ningún chat coincide con «{q.trim()}».</div>;
  }
  if (queue === "attention") {
    return (
      <div className="space-y-1 p-8 text-center">
        <p className="text-base font-medium text-(--wa-text)">Nada te espera. 🎉</p>
        <p className="text-sm text-(--wa-meta)">Cuando un chat te necesite, aparece aquí.</p>
      </div>
    );
  }
  if (queue === "seguimiento") {
    return (
      <div className="space-y-1 p-8 text-center">
        <p className="text-base font-medium text-(--wa-text)">Nadie en seguimiento</p>
        <p className="text-sm text-(--wa-meta)">
          Aquí aparece quien escribió, lleva más de 2 días sin moverse y no ha agendado ni pagado.
        </p>
      </div>
    );
  }
  return <div className="p-8 text-center text-sm text-(--wa-meta)">No hay chats aquí.</div>;
};

/** La columna de la izquierda: buscar, «Te toca» / «Todos» / «Seguimiento» y la lista. */
const ChatList = ({
  items,
  counts,
  queue,
  q,
  generalMode,
  selectedId,
  canLoadMore,
  hidden,
  now,
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
  /** El modo general: la fila solo marca el modo si es otro. */
  generalMode: ChatListItem["aiMode"] | null;
  selectedId: string | null;
  canLoadMore: boolean;
  /** En el celular, con un chat abierto, la lista se esconde. */
  hidden: boolean;
  /** Reloj de la lista («Te toca · hace 5 min»). */
  now: number;
  onQueue: (id: ChatQueue) => void;
  onQuery: (q: string) => void;
  onSearch: () => void;
  onOpen: (id: string) => void;
  onLoadMore: () => void;
  onToggleSidebar: () => void;
  onModeChanged: () => void;
}) => {
  const tab = tabOf(queue);
  return (
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
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-(--wa-text)">Chats</h1>
        {counts.unread > 0 && (
          <span className="shrink-0 rounded-full bg-(--wa-unread) px-2 py-0.5 text-xs font-semibold text-white">
            {counts.unread} sin leer
          </span>
        )}
        <GlobalModeSwitch onChanged={onModeChanged} />
      </div>
      <div className="space-y-2 border-b border-(--wa-divider) px-3 py-2">
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
        <div className="flex gap-2 overflow-x-auto pb-0.5" role="group" aria-label="Qué chats ver">
          {TABS.map((t) => {
            const n = t.id === "attention" ? counts.attention : t.id === "seguimiento" ? counts.seguimiento : null;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                title={t.hint}
                onClick={() => onQueue(t.id === "all" ? "all" : t.id)}
                aria-pressed={active}
                className={chip(active)}
              >
                {t.label}
                {n !== null && n > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[11px]",
                      t.id === "attention" ? "bg-(--wa-green) text-white" : "bg-(--wa-surface)/80 text-(--wa-icon)"
                    )}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {tab === "all" && (
          <div className="flex items-center gap-1.5 overflow-x-auto" role="group" aria-label="Quién responde">
            <span className="shrink-0 text-xs text-(--wa-meta)">Quién responde:</span>
            {MODE_FILTERS.map((f) => {
              const active = queue === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  title={f.hint}
                  aria-pressed={active}
                  onClick={() => onQueue(f.id)}
                  className={cn(
                    "h-10 shrink-0 rounded-full px-2.5 text-xs font-medium transition-colors md:h-7",
                    active ? "bg-(--wa-text) text-(--wa-surface)" : "text-(--wa-icon) hover:bg-(--wa-panel)"
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {q.trim() && items !== null && items.length > 0 && (
          // Buscar mira todos los chats, no solo la pestaña abierta.
          <p className="px-4 pt-2 text-xs text-(--wa-meta)">Resultados en todos los chats</p>
        )}
        {items === null && (
          <div className="grid place-items-center p-8">
            <Loader2 className="size-5 animate-spin text-(--wa-green)" />
          </div>
        )}
        {items?.length === 0 && <Empty queue={queue} q={q} />}
        {items?.map((item) => (
          <ChatRow
            key={item.id}
            item={item}
            active={item.id === selectedId}
            now={now}
            generalMode={generalMode}
            onOpen={() => onOpen(item.id)}
          />
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
};

export default ChatList;
