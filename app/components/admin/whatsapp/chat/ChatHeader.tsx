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
  RefreshCw,
  Search,
  ShieldAlert,
  Star,
  Tags,
  Undo2,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { CHAT_CATEGORIES, CHAT_CATEGORY_LABEL, isChatCategory, type ChatCategory } from "@/lib/crm/chat-category-rules";
import { categoryChangeNeedsOwner } from "@/lib/crm/whatsapp-category-filter";
import { cn } from "@/lib/utils";
import type { ChatDetail } from "@/lib/crm/whatsapp-agent/workspace";
import {
  APPROVAL_LABEL,
  CATEGORY_LABEL,
  MODE_LABEL,
  MODE_SHORT,
  RunStatus,
  agoLabel,
  attentionLabel,
  isRunLive,
} from "../status";
import { useCrm } from "../../crm/CrmProvider";
import { wa } from "./chatTheme";
import { ActionButton, Avatar } from "./ui";

type Act = (key: string, body: Record<string, unknown>, done?: string) => unknown;
/** Cambiar la categoría (`/api/admin/whatsapp/categories`). */
export type CategoryAct = (body: Record<string, unknown>, done: string) => unknown;

const MODES = ["AUTO", "COPILOT", "MANUAL"] as const;
/** Opciones del menú cómodas con el dedo. */
const ITEM = "min-h-10 gap-2 px-2.5 text-sm";

/**
 * «Te toca» (o algo por autorizar): por qué, y UNA acción, «Listo». Contestar
 * también lo saca de aquí; «Listo» es para lo que se resolvió por otro lado.
 * Una escalada delicada (clínica, pago, urgente) sigue aquí después de
 * contestar: la IA no vuelve hasta que ella pulse «Listo».
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
  const escalation = chat.escalation;
  if (!a && !approval && !escalation) return null;
  const cause = escalation?.cause ?? null;
  const urgent = Boolean(a?.urgent) || (cause !== "manual" && escalation?.severity === "urgent");
  const title = a
    ? attentionLabel(a)
    : approval
      ? (APPROVAL_LABEL[approval] ?? APPROVAL_LABEL.reply)
      : cause === "manual"
        ? "IA en pausa (la pausaste tú)"
        : `${urgent ? "Urgente" : "IA en pausa"} · ${CATEGORY_LABEL[escalation?.category ?? ""] ?? "Revisar"}`;
  // Sin «Te toca» ni propuesta: por qué la IA sigue apartada.
  const pausedDetail: Record<string, string> = {
    manual: "Pulsa «Listo» cuando quieras que la IA vuelva a este chat.",
    payment: "Se resolvió con el pago. La IA vuelve a este chat cuando pulses «Listo».",
    appointment: "Se resolvió con la cita. La IA vuelve a este chat cuando pulses «Listo».",
    answered: "Ya contestaste. La IA no vuelve a este chat hasta que pulses «Listo».",
    waiting: "La IA no vuelve a este chat hasta que pulses «Listo».",
  };
  // Con una propuesta abajo, el motivo ya lo dice ella: aquí solo desde cuándo.
  const detail = a
    ? [approval ? null : a.detail, a.reason === "unanswered" ? `escribió ${agoLabel(a.since, now)}` : agoLabel(a.since, now)]
        .filter(Boolean)
        .join(" · ")
    : approval
      ? "Acéptalo o cancélalo abajo, o contéstale tú."
      : (pausedDetail[cause ?? "waiting"] ?? pausedDetail.waiting);
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

/**
 * La categoría del chat (cliente, interesada, personal…): elegirla a mano (gana
 * siempre), volver a lo automático o pedir que se vuelva a mirar. Callar un
 * chat (o quitarle esa marca) y reclasificar con la IA, solo la dueña: al
 * resto esas opciones le salen apagadas.
 */
const CategoryMenu = ({
  chat,
  disabled,
  onCategory,
}: {
  chat: ChatDetail;
  disabled: boolean;
  onCategory: CategoryAct;
}) => {
  const { role } = useCrm();
  const isOwner = role === "OWNER";
  const c = chat.classification;
  const current = c.category && isChatCategory(c.category) ? CHAT_CATEGORY_LABEL[c.category] : "Sin clasificar";
  const label = { category: c.category, categorySource: c.source };
  const ownerOnly = (next: string | null) => !isOwner && categoryChangeNeedsOwner(label, next);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={ITEM}>
        <Tags className="size-4" />
        <span className="min-w-0 flex-1 truncate">
          Categoría: <span className="font-medium">{current}</span>
          {c.source === "manual" ? <span className="text-muted-foreground"> · a mano</span> : null}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Marcar a mano</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={c.source === "manual" ? (c.category ?? "") : ""}
            onValueChange={(category) =>
              onCategory(
                { action: "set", conversationId: chat.id, category },
                `Categoría: ${CHAT_CATEGORY_LABEL[category as ChatCategory] ?? category}`
              )
            }
          >
            {CHAT_CATEGORIES.map((cat) => (
              <DropdownMenuRadioItem key={cat} value={cat} disabled={disabled || ownerOnly(cat)} className={ITEM}>
                {CHAT_CATEGORY_LABEL[cat]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {c.source === "manual" && (
          <DropdownMenuItem
            className={ITEM}
            disabled={disabled || ownerOnly(null)}
            onClick={() =>
              onCategory({ action: "set", conversationId: chat.id, category: null }, "Vuelve a clasificarse solo")
            }
          >
            <Undo2 /> Volver a automático
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className={ITEM}
          disabled={disabled || c.source === "manual" || !isOwner}
          onClick={() => onCategory({ action: "reclassify", conversationId: chat.id }, "Se volvió a mirar")}
        >
          <RefreshCw /> Reclasificar
        </DropdownMenuItem>
        {!isOwner && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Callar un chat (personal, negocio, equipo) o reclasificarlo: solo la dueña.
          </p>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};

/** Lo que no se usa a diario: modo, tomar/devolver, favorito, categoría, la ficha, lo que sabe la IA. */
const ChatMenu = ({
  chat,
  canWrite,
  busy,
  act,
  onToggleInfo,
  onCategory,
}: {
  chat: ChatDetail;
  canWrite: boolean;
  busy: string | null;
  act: Act;
  onToggleInfo: () => void;
  onCategory: CategoryAct;
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
            // Tomarlo también lo marca como favorito ⭐ (la API pone las dos cosas).
            onClick={() => act("take", { action: "take" }, "Modo Yo y favorito ⭐: la IA no toca este chat")}
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
        <CategoryMenu chat={chat} disabled={disabled} onCategory={onCategory} />
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
  onCategory,
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
  onCategory: CategoryAct;
}) => {
  const lastRun = chat.runs[0] ?? null;
  const live = isRunLive(lastRun);
  const needsYou = Boolean(chat.attention || chat.approvals.length > 0 || chat.escalation);
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
        <ChatMenu
          chat={chat}
          canWrite={canWrite}
          busy={busy}
          act={act}
          onToggleInfo={onToggleInfo}
          onCategory={onCategory}
        />
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
