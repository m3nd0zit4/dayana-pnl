"use client";

import {
  ArrowLeft,
  Bot,
  CalendarClock,
  CheckCheck,
  Hand,
  Loader2,
  PanelLeft,
  PanelRight,
  Paperclip,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Star,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSidebar } from "@/app/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { ChatDetail, ChatListItem, ChatQueue } from "@/lib/crm/whatsapp-agent/workspace";
import { useCrm } from "../crm/CrmProvider";
import { useWhatsAppLive } from "./live";
import { CATEGORY_LABEL, MODE_LABEL, RunStatus, agoLabel, isRunLive, useNow } from "./status";

/**
 * Chats de WhatsApp, con la cara de WhatsApp Web: lista blanca a la izquierda,
 * conversación con el fondo beige y burbujas verdes, barra de escribir abajo.
 * Encima de eso, lo de la IA: quién atiende cada chat, qué está haciendo ahora
 * y los botones para tomarlo o devolverlo.
 */

const WA = {
  green: "#00a884",
  greenDark: "#008069",
  panel: "#f0f2f5",
  chatBg: "#efeae2",
  outgoing: "#d9fdd3",
  text: "#111b21",
  muted: "#667781",
};

type Counts = { attention: number; mine: number; ai: number; unread: number };

const QUEUES: { id: ChatQueue; label: string; hint: string }[] = [
  { id: "all", label: "Todos", hint: "Todos los chats" },
  { id: "attention", label: "Te toca", hint: "La IA te los pasó" },
  { id: "mine", label: "Tuyos", hint: "Tomados o favoritos: la IA no los toca" },
  { id: "ai", label: "IA", hint: "Los atiende la IA" },
];

const QUICK_REPLIES = [
  "¡Hola! Ya te leo con calma y te respondo en un momento 💛",
  "Gracias por escribir, te respondo hoy mismo.",
  "Perfecto, quedo atenta.",
];

const post = async (id: string, body: Record<string, unknown>) => {
  const res = await fetch(`/api/admin/whatsapp/chats/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data.error ?? "error"));
  return data;
};

const timeLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
};

const initials = (name: string) =>
  name
    .replace(/^\+/, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

const Avatar = ({ name, size = 49 }: { name: string; size?: number }) => (
  <span
    className="grid shrink-0 place-items-center rounded-full bg-[#dfe5e7] text-sm font-medium text-[#54656f] dark:bg-muted dark:text-muted-foreground"
    style={{ width: size, height: size }}
  >
    {/^\+?\d/.test(name) ? <UserRound className="size-6" /> : initials(name)}
  </span>
);

/** Etiqueta pequeña de quién atiende el chat, como las etiquetas de WhatsApp Business. */
const HandlerTag = ({ item }: { item: Pick<ChatListItem, "aiMode" | "paused" | "priority"> }) => {
  const [label, cls] = item.priority
    ? ["Favorito", "bg-[#fff1c2] text-[#7a5b00]"]
    : item.aiMode === "MANUAL"
      ? ["Tú", "bg-[#e7f0ff] text-[#1d4ed8]"]
      : item.aiMode === "COPILOT"
        ? ["Copiloto", "bg-[#f1e9ff] text-[#6d28d9]"]
        : item.paused
          ? ["IA en pausa", "bg-[#f0f2f5] text-[#54656f]"]
          : ["IA", "bg-[#d9fdd3] text-[#006e4f]"];
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", cls)}>{label}</span>
  );
};

const ChatRow = ({ item, active, onOpen }: { item: ChatListItem; active: boolean; onOpen: () => void }) => {
  const urgent = item.escalation?.severity === "urgent";
  const unread = item.unreadCount > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 px-3 text-left transition-colors hover:bg-[#f5f6f6] dark:hover:bg-muted/50",
        active && "bg-[#f0f2f5] dark:bg-muted"
      )}
    >
      <Avatar name={item.name} />
      <div className="min-w-0 flex-1 border-b border-[#e9edef] py-3 dark:border-border">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] text-[#111b21] dark:text-foreground">{item.name}</span>
          <span className={cn("shrink-0 text-xs", unread ? "font-medium text-[#00a884]" : "text-[#667781]")}>
            {timeLabel(item.lastMessageAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          {item.lastDirection === "OUTBOUND" && (
            <CheckCheck className="size-4 shrink-0 text-[#53bdeb]" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm text-[#667781]">
            {item.lastDirection === "OUTBOUND" && item.lastIsAutoReply ? "IA: " : ""}
            {item.lastMessage ?? "📎 Adjunto"}
          </span>
          {item.priority && <Star className="size-3.5 shrink-0 fill-[#f5b400] text-[#f5b400]" />}
          {unread && (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#25d366] px-1.5 text-[11px] font-semibold text-white">
              {item.unreadCount}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          {item.escalation ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-medium",
                urgent ? "text-[#d92d20]" : "text-[#008069]"
              )}
            >
              <ShieldAlert className="size-3.5" />
              {urgent ? "Urgente · " : "Te toca · "}
              {CATEGORY_LABEL[item.escalation.category ?? ""] ?? "revisar"}
            </span>
          ) : (
            <RunStatus run={item.lastRun} compact className="min-w-0 flex-1" />
          )}
          <span className="ml-auto" />
          <HandlerTag item={item} />
        </div>
      </div>
    </button>
  );
};

/** Botón claro y visible, en la paleta de WhatsApp. */
const ActionButton = ({
  children,
  onClick,
  disabled,
  tone = "outline",
  title,
}: {
  children: React.ReactNode;
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
      "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors disabled:opacity-50 [&_svg]:size-4",
      tone === "primary" && "bg-[#00a884] text-white hover:bg-[#008069]",
      tone === "outline" &&
        "border border-[#d1d7db] bg-white text-[#111b21] hover:bg-[#f5f6f6] dark:border-border dark:bg-card dark:text-foreground",
      tone === "danger" && "border border-[#f3b9b4] bg-white text-[#b42318] hover:bg-[#fef3f2]"
    )}
  >
    {children}
  </button>
);

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
    className="inline-flex h-9 items-center rounded-full border border-[#d1d7db] bg-white p-0.5 dark:border-border dark:bg-card"
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
          "h-8 rounded-full px-3 text-sm font-medium transition-colors",
          mode === m ? "bg-[#00a884] text-white" : "text-[#54656f] hover:text-[#111b21] dark:text-muted-foreground"
        )}
      >
        {m === "AUTO" ? "IA" : m === "COPILOT" ? "Copiloto" : "Yo"}
      </button>
    ))}
  </div>
);

const Thread = ({
  chat,
  canWrite,
  onBack,
  onChanged,
}: {
  chat: ChatDetail;
  canWrite: boolean;
  onBack: () => void;
  onChanged: () => void;
}) => {
  const { toast } = useCrm();
  const { toggleSidebar } = useSidebar();
  const [text, setText] = useState(chat.draft?.body ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [memory, setMemory] = useState(chat.memory?.notes ?? "");
  const [showInfo, setShowInfo] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const lastRun = chat.runs[0] ?? null;
  const live = isRunLive(lastRun);
  const now = useNow(true, 30_000);

  // Un borrador nuevo de la IA reemplaza el texto solo si Dayana no está
  // escribiendo otra cosa.
  const lastDraft = useRef(chat.draft?.body ?? "");
  useEffect(() => {
    const incoming = chat.draft?.body ?? "";
    if (incoming !== lastDraft.current) {
      setText((current) => (current.trim() === "" || current === lastDraft.current ? incoming : current));
      lastDraft.current = incoming;
    }
  }, [chat.draft?.body]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.id, chat.messages.length]);

  useEffect(() => {
    setMemory(chat.memory?.notes ?? "");
  }, [chat.id, chat.memory?.notes]);

  const act = async (key: string, body: Record<string, unknown>, done?: string) => {
    setBusy(key);
    try {
      const data = await post(chat.id, body);
      if (done) toast(done, "success");
      onChanged();
      return data;
    } catch (e) {
      const code = e instanceof Error ? e.message : "error";
      toast(
        code === "window_closed"
          ? "Pasaron más de 24 h desde su último mensaje: WhatsApp solo deja escribir con plantilla."
          : `No se pudo: ${code}`,
        "error"
      );
      return null;
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    const ok = await act("send", { action: "send", body });
    if (ok) {
      setText("");
      lastDraft.current = "";
    }
  };

  const suggest = async () => {
    const data = (await act("suggest", { action: "suggest" })) as
      | { draft: { action: string; message: string; reason: string } }
      | null;
    if (!data) return;
    if (data.draft.action === "reply") {
      setText(data.draft.message);
      lastDraft.current = data.draft.message;
    } else {
      toast(`La IA te lo dejaría a ti: ${data.draft.reason}`, "info");
    }
  };

  const slots = async () => {
    const data = (await act("slots", { action: "slots" })) as { text: string } | null;
    if (!data) return;
    if (!data.text) toast("No hay horas libres en tu horario de citas.", "info");
    else setText((t) => (t.trim() ? `${t}\n\n${data.text}` : data.text));
  };

  const mine = chat.aiMode === "MANUAL" || chat.priority;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabecera, como la de WhatsApp Web */}
      <div className="flex min-h-[60px] flex-wrap items-center gap-2 border-l border-[#d1d7db] bg-[#f0f2f5] px-3 py-2 dark:border-border dark:bg-muted/40">
        <button type="button" className="md:hidden" onClick={onBack} aria-label="Volver">
          <ArrowLeft className="size-5 text-[#54656f]" />
        </button>
        <button
          type="button"
          className="hidden text-[#54656f] hover:text-[#111b21] md:block"
          onClick={toggleSidebar}
          title="Mostrar u ocultar el menú"
          aria-label="Mostrar u ocultar el menú"
        >
          <PanelLeft className="size-5" />
        </button>
        <Avatar name={chat.name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base text-[#111b21] dark:text-foreground">{chat.name}</div>
          <div className="flex items-center gap-2 text-xs text-[#667781]">
            <span>+{chat.phone}</span>
            {chat.contactId && (
              <Link href={`/admin/contacts/${chat.contactId}`} className="font-medium text-[#008069] hover:underline">
                Ver ficha
              </Link>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => act("priority", { action: "priority", on: !chat.priority }, chat.priority ? "Ya no es favorito" : "Favorito: la IA no toca este chat")}
          disabled={!canWrite}
          title={chat.priority ? "Quitar de favoritos" : "Favorito: la IA no lo toca"}
          className="grid size-9 place-items-center rounded-full hover:bg-black/5"
        >
          <Star className={cn("size-5", chat.priority ? "fill-[#f5b400] text-[#f5b400]" : "text-[#54656f]")} />
        </button>
        <ModeSwitch
          mode={chat.aiMode}
          disabled={!canWrite || busy !== null}
          onChange={(mode) => act("mode", { action: "mode", mode }, MODE_LABEL[mode])}
        />
        {mine ? (
          <ActionButton tone="outline" disabled={!canWrite || busy !== null} onClick={() => act("release", { action: "release" }, "La IA vuelve a atender este chat")}>
            <Bot /> Devolver a la IA
          </ActionButton>
        ) : (
          <ActionButton tone="primary" disabled={!canWrite || busy !== null} onClick={() => act("take", { action: "take" }, "Chat tuyo: la IA no escribe aquí")}>
            <Hand /> Tomar chat
          </ActionButton>
        )}
        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          title="Lo que sabe la IA de este chat"
          aria-label="Lo que sabe la IA de este chat"
          className={cn("grid size-9 place-items-center rounded-full hover:bg-black/5", showInfo && "bg-black/5")}
        >
          <PanelRight className="size-5 text-[#54656f]" />
        </button>
      </div>

      {/* Qué está haciendo la IA aquí */}
      {chat.escalation ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#e9edef] bg-white px-4 py-2.5 text-sm dark:border-border dark:bg-card">
          <ShieldAlert className={cn("size-5 shrink-0", chat.escalation.severity === "urgent" ? "text-[#d92d20]" : "text-[#008069]")} />
          <span className="min-w-0 flex-1 text-[#111b21] dark:text-foreground">
            <strong>
              {chat.escalation.severity === "urgent" ? "Urgente — " : "Te toca — "}
              {CATEGORY_LABEL[chat.escalation.category ?? ""] ?? "revisar"}.
            </strong>{" "}
            <span className="text-[#54656f]">{chat.escalation.reason}</span>
          </span>
          <ActionButton tone="primary" disabled={!canWrite || busy !== null} onClick={() => act("resume", { action: "resume" }, "La IA vuelve a responder aquí")}>
            <RotateCcw /> Listo, que siga la IA
          </ActionButton>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-b border-[#e9edef] bg-white px-4 py-1.5 dark:border-border dark:bg-card">
          {lastRun ? (
            <RunStatus run={lastRun} className={cn(live && "font-medium")} />
          ) : (
            <span className="text-xs text-[#667781]">La IA aún no ha mirado este chat.</span>
          )}
          <span className="ml-auto text-xs text-[#667781]">
            {chat.priority ? "Favorito: la IA no lo toca" : MODE_LABEL[chat.aiMode]}
            {chat.paused && !chat.priority ? " · en pausa" : ""}
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Mensajes */}
          <div
            className="min-h-0 flex-1 space-y-1 overflow-y-auto px-[6%] py-4 dark:bg-muted/20"
            style={{ backgroundColor: WA.chatBg }}
          >
            {chat.messages.map((m) => {
              const out = m.direction === "OUTBOUND";
              return (
                <div key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[75%] rounded-lg px-2.5 pt-1.5 pb-1 text-[14.2px] leading-snug text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]",
                      out ? "rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white",
                      m.status === "FAILED" && "ring-1 ring-[#d92d20]"
                    )}
                  >
                    {m.isAutoReply && (
                      <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-[#008069]">
                        <Bot className="size-3" /> Asistente IA
                      </div>
                    )}
                    {m.attachments.map((a, i) =>
                      a.url && a.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={a.url} alt={a.caption ?? "imagen"} className="mb-1 max-h-72 rounded-md" />
                      ) : (
                        <a key={i} href={a.url ?? undefined} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-1 text-sm text-[#027eb5] underline">
                          <Paperclip className="size-3.5" /> {a.kind}
                        </a>
                      )
                    )}
                    {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                    <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[#667781]">
                      {m.isEcho && <Smartphone className="size-3" aria-label="Desde el celular" />}
                      {m.staffName && !m.isAutoReply && <span>{m.staffName} ·</span>}
                      <span>{new Date(m.sentAt).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" })}</span>
                      {out && m.status !== "FAILED" && (
                        <CheckCheck className={cn("size-4", m.status === "READ" ? "text-[#53bdeb]" : "text-[#8696a0]")} />
                      )}
                      {m.status === "FAILED" && <span className="font-medium text-[#d92d20]">no enviado</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          {/* Escribir */}
          <div className="space-y-2 bg-[#f0f2f5] px-3 py-2 dark:bg-muted/40">
            {!chat.windowOpen && (
              <p className="rounded-md bg-white px-3 py-1.5 text-xs text-[#54656f] dark:bg-card">
                Pasaron más de 24 h desde su último mensaje: WhatsApp solo deja escribir cuando vuelva a escribir.
              </p>
            )}
            {chat.draft?.source === "AI" && text === chat.draft.body && (
              <p className="flex items-center gap-1 text-xs font-medium text-[#008069]">
                <Sparkles className="size-3.5" /> Borrador de la IA: envíalo o cámbialo (aprende de tus cambios).
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <ActionButton tone="outline" disabled={!canWrite || busy !== null} onClick={suggest}>
                {busy === "suggest" ? <Loader2 className="animate-spin" /> : <Sparkles className="text-[#00a884]" />} Que la IA proponga
              </ActionButton>
              <ActionButton tone="outline" disabled={!canWrite || busy !== null} onClick={slots}>
                {busy === "slots" ? <Loader2 className="animate-spin" /> : <CalendarClock className="text-[#00a884]" />} Horas libres
              </ActionButton>
              {QUICK_REPLIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setText(q)}
                  disabled={!canWrite}
                  className="h-9 max-w-[16rem] truncate rounded-full border border-[#d1d7db] bg-white px-3 text-sm text-[#111b21] hover:bg-[#f5f6f6] dark:border-border dark:bg-card dark:text-foreground"
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={canWrite ? "Escribe un mensaje" : "Solo lectura"}
                disabled={!canWrite}
                rows={1}
                className="max-h-40 min-h-[42px] flex-1 resize-none rounded-lg border-0 bg-white px-3 py-2.5 text-[15px] text-[#111b21] outline-none placeholder:text-[#667781] dark:bg-card dark:text-foreground"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button
                type="button"
                onClick={send}
                disabled={!canWrite || !text.trim() || busy !== null || !chat.windowOpen}
                aria-label="Enviar"
                className="grid size-[42px] shrink-0 place-items-center rounded-full bg-[#00a884] text-white hover:bg-[#008069] disabled:opacity-40"
              >
                {busy === "send" ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
              </button>
            </div>
            {chat.aiMode === "AUTO" && !chat.paused && !chat.priority && (
              <p className="text-[11px] text-[#667781]">Enter envía · Shift+Enter nueva línea · si escribes aquí, la IA se aparta unas horas.</p>
            )}
          </div>
        </div>

        {/* Lo que sabe la IA */}
        {showInfo && (
          <aside className="w-80 shrink-0 space-y-5 overflow-y-auto border-l border-[#d1d7db] bg-white p-4 text-sm dark:border-border dark:bg-card">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-[#008069]">Lo que la IA recuerda</h3>
              <textarea
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                rows={7}
                placeholder="Aún nada. La IA la escribe al conversar; también puedes escribirla tú."
                disabled={!canWrite}
                className="w-full rounded-lg border border-[#d1d7db] bg-white p-2 text-sm outline-none focus:border-[#00a884] dark:border-border dark:bg-card"
              />
              <ActionButton tone="primary" disabled={!canWrite || memory === (chat.memory?.notes ?? "") || busy !== null} onClick={() => act("memory", { action: "memory", notes: memory }, "Guardado")}>
                Guardar
              </ActionButton>
            </section>

            {chat.bookings.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-[#008069]">Citas que agendó la IA</h3>
                {chat.bookings.map((b) => (
                  <div key={b.id} className="rounded-lg border border-[#e9edef] p-2.5 dark:border-border">
                    <div className="font-medium">{b.service}</div>
                    <div className="capitalize text-[#54656f]">
                      {new Date(b.startsAt).toLocaleString("es-CO", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}
                    </div>
                    {b.meetUrl && <a href={b.meetUrl} target="_blank" rel="noreferrer" className="font-medium text-[#027eb5] hover:underline">Abrir Meet</a>}
                  </div>
                ))}
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-[#008069]">Lo que hizo la IA aquí</h3>
              {chat.runs.length === 0 && <p className="text-[#667781]">Nada todavía.</p>}
              {chat.runs.slice(0, 8).map((r) => {
                const tools = Array.isArray(r.toolCalls) ? (r.toolCalls as { tool: string }[]).map((t) => t.tool) : [];
                return (
                  <div key={r.id} className="space-y-0.5 border-b border-[#e9edef] pb-2 dark:border-border">
                    <RunStatus run={r} />
                    <div className="text-xs text-[#667781]">
                      {agoLabel(r.queuedAt, now)}
                      {tools.length > 0 && ` · usó: ${[...new Set(tools)].join(", ")}`}
                    </div>
                    {r.reason && r.status !== "SKIPPED" && <div className="text-xs text-[#54656f]">{r.reason}</div>}
                  </div>
                );
              })}
            </section>
          </aside>
        )}
      </div>
    </div>
  );
};

const WhatsAppChatsClient = ({ initialConversationId }: { initialConversationId: string | null }) => {
  const { canWrite, toast } = useCrm();
  const { toggleSidebar } = useSidebar();
  const [queue, setQueue] = useState<ChatQueue>("all");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ChatListItem[] | null>(null);
  const [counts, setCounts] = useState<Counts>({ attention: 0, mine: 0, ai: 0, unread: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId);
  const [chat, setChat] = useState<ChatDetail | null>(null);
  const queueRef = useRef(queue);
  const qRef = useRef(q);
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    queueRef.current = queue;
    qRef.current = q;
    selectedRef.current = selectedId;
  });

  const loadList = useCallback(async () => {
    const params = new URLSearchParams({ queue: queueRef.current });
    if (qRef.current.trim()) params.set("q", qRef.current.trim());
    try {
      const res = await fetch(`/api/admin/whatsapp/chats?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { items: ChatListItem[]; counts: Counts };
      setItems(data.items);
      setCounts(data.counts);
    } catch {
      toast("No se pudo cargar la lista de chats.", "error");
    }
  }, [toast]);

  const loadChat = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/admin/whatsapp/chats/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as ChatDetail;
        if (selectedRef.current === id) setChat(data);
      } catch {
        toast("No se pudo abrir el chat.", "error");
      }
    },
    [toast]
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    selectedRef.current = selectedId;
    if (!selectedId) {
      setChat(null);
      return;
    }
    setChat(null);
    void loadChat(selectedId);
    void post(selectedId, { action: "read" }).catch(() => undefined);
    const url = new URL(window.location.href);
    url.searchParams.set("conversation", selectedId);
    window.history.replaceState(null, "", url);
  }, [selectedId, loadChat]);

  useWhatsAppLive(() => {
    void loadList();
    if (selectedRef.current) void loadChat(selectedRef.current);
  });

  // Mientras la IA trabaja en algún chat, el reloj de la lista avanza.
  const anyLive = useMemo(() => (items ?? []).some((i) => isRunLive(i.lastRun)), [items]);
  useNow(anyLive);

  const refresh = () => {
    void loadList();
    if (selectedId) void loadChat(selectedId);
  };

  const pickQueue = (id: ChatQueue) => {
    queueRef.current = id;
    setQueue(id);
    void loadList();
  };

  return (
    <div className="flex h-full min-h-0 w-full bg-white dark:bg-background">
      {/* Lista de chats */}
      <div
        className={cn(
          "flex w-full min-w-0 flex-col md:w-[26rem] md:shrink-0",
          selectedId && "hidden md:flex"
        )}
      >
        <div className="flex h-[60px] items-center gap-3 bg-[#f0f2f5] px-4 dark:bg-muted/40">
          <button
            type="button"
            onClick={toggleSidebar}
            title="Mostrar u ocultar el menú"
            aria-label="Mostrar u ocultar el menú"
            className="text-[#54656f] hover:text-[#111b21]"
          >
            <PanelLeft className="size-5" />
          </button>
          <h1 className="flex-1 text-lg font-semibold text-[#111b21] dark:text-foreground">Chats</h1>
          {counts.unread > 0 && (
            <span className="rounded-full bg-[#25d366] px-2 py-0.5 text-xs font-semibold text-white">{counts.unread} sin leer</span>
          )}
        </div>
        <div className="space-y-2 border-b border-[#e9edef] px-3 py-2 dark:border-border">
          <div className="flex items-center gap-2 rounded-lg bg-[#f0f2f5] px-3 dark:bg-muted/40">
            <Search className="size-4 shrink-0 text-[#54656f]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void loadList()}
              onBlur={() => void loadList()}
              placeholder="Buscar un chat o número"
              className="h-9 w-full bg-transparent text-sm text-[#111b21] outline-none placeholder:text-[#667781] dark:text-foreground"
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
                  onClick={() => pickQueue(qq.id)}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
                    active ? "bg-[#d9fdd3] text-[#008069]" : "bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef] dark:bg-muted/40"
                  )}
                >
                  {qq.label}
                  {n !== null && n > 0 && (
                    <span className={cn("rounded-full px-1.5 text-[11px]", qq.id === "attention" ? "bg-[#00a884] text-white" : "bg-white/80 text-[#54656f]")}>
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
              <Loader2 className="size-5 animate-spin text-[#00a884]" />
            </div>
          )}
          {items?.length === 0 && (
            <div className="p-8 text-center text-sm text-[#667781]">
              {queue === "attention" ? "Nada pendiente: la IA no te ha pasado ningún chat." : "No hay chats aquí."}
            </div>
          )}
          {items?.map((item) => (
            <ChatRow key={item.id} item={item} active={item.id === selectedId} onOpen={() => setSelectedId(item.id)} />
          ))}
        </div>
      </div>

      {/* Conversación */}
      <div className={cn("min-w-0 flex-1", !selectedId && "hidden md:block")}>
        {!selectedId && (
          <div className="grid h-full place-items-center border-l border-[#d1d7db] bg-[#f0f2f5] p-8 text-center dark:border-border dark:bg-muted/30">
            <div className="max-w-sm space-y-3">
              <span className="mx-auto grid size-16 place-items-center rounded-full bg-[#d9fdd3] text-[#008069]">
                <Bot className="size-8" />
              </span>
              <h2 className="text-2xl font-light text-[#41525d] dark:text-foreground">WhatsApp de Dayana</h2>
              <p className="text-sm text-[#667781]">
                Elige un chat. En «Te toca» están los que la IA te pasó. La ⭐ marca un chat como favorito: la IA no lo toca.
              </p>
            </div>
          </div>
        )}
        {selectedId && !chat && (
          <div className="grid h-full place-items-center border-l border-[#d1d7db] dark:border-border" style={{ backgroundColor: WA.chatBg }}>
            <Loader2 className="size-6 animate-spin text-[#00a884]" />
          </div>
        )}
        {chat && (
          <Thread key={chat.id} chat={chat} canWrite={canWrite} onBack={() => setSelectedId(null)} onChanged={refresh} />
        )}
      </div>
    </div>
  );
};

export default WhatsAppChatsClient;
