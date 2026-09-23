"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CalendarClock,
  Hand,
  Loader2,
  Paperclip,
  RotateCcw,
  Search,
  Send,
  Smartphone,
  Sparkles,
  Star,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChatDetail, ChatListItem, ChatQueue } from "@/lib/crm/whatsapp-agent/workspace";
import { useCrm } from "../crm/CrmProvider";
import { useWhatsAppLive } from "./live";
import { CATEGORY_LABEL, MODE_LABEL, RunStatus, agoLabel, isRunLive, useNow } from "./status";

type Counts = { attention: number; mine: number; ai: number; unread: number };

const QUEUES: { id: ChatQueue; label: string; hint: string }[] = [
  { id: "attention", label: "Te toca", hint: "La IA te los pasó" },
  { id: "mine", label: "Tú atiendes", hint: "Tomados o prioritarios" },
  { id: "ai", label: "IA atendiendo", hint: "La IA los lleva" },
  { id: "all", label: "Todos", hint: "" },
];

const QUICK_REPLIES = [
  "¡Hola! Ya te leo con calma y te respondo en un momento 💛",
  "Gracias por escribir. Dayana te responde personalmente hoy.",
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

const ChatRow = ({
  item,
  active,
  onOpen,
}: {
  item: ChatListItem;
  active: boolean;
  onOpen: () => void;
}) => {
  const urgent = item.escalation?.severity === "urgent";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full flex-col gap-1 border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
        active && "bg-muted",
        item.escalation && "border-l-4 border-l-amber-500",
        urgent && "border-l-red-600 bg-red-50/60 dark:bg-red-950/20"
      )}
    >
      <div className="flex items-center gap-2">
        {item.priority && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" />}
        <span className={cn("min-w-0 flex-1 truncate text-sm", item.unreadCount > 0 ? "font-semibold" : "font-medium")}>
          {item.name}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{timeLabel(item.lastMessageAt)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {item.lastDirection === "OUTBOUND" ? (item.lastIsAutoReply ? "IA: " : "Tú: ") : ""}
          {item.lastMessage ?? "(adjunto)"}
        </span>
        {item.unreadCount > 0 && (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#25d366] text-[10px] font-bold text-white">
            {item.unreadCount}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {item.escalation ? (
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium", urgent ? "text-red-700" : "text-amber-700")}>
            <AlertTriangle className="size-3.5" />
            {urgent ? "URGENTE · " : ""}
            {CATEGORY_LABEL[item.escalation.category ?? ""] ?? "Te toca"}
          </span>
        ) : (
          <RunStatus run={item.lastRun} compact />
        )}
        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {item.aiMode === "MANUAL" ? "Tú" : item.aiMode === "COPILOT" ? "Copiloto" : item.paused ? "Pausa" : "IA"}
        </span>
      </div>
    </button>
  );
};

const ModeSwitch = ({
  mode,
  disabled,
  onChange,
}: {
  mode: ChatDetail["aiMode"];
  disabled: boolean;
  onChange: (mode: ChatDetail["aiMode"]) => void;
}) => (
  <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="radiogroup" aria-label="Quién responde">
    {(["AUTO", "COPILOT", "MANUAL"] as const).map((m) => (
      <button
        key={m}
        type="button"
        role="radio"
        aria-checked={mode === m}
        disabled={disabled}
        onClick={() => onChange(m)}
        className={cn(
          "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
          mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
        )}
        title={MODE_LABEL[m]}
      >
        {m === "AUTO" ? "IA sola" : m === "COPILOT" ? "Copiloto" : "Yo"}
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
      toast(`La IA no contestaría esto: ${data.draft.reason}`, "info");
    }
  };

  const slots = async () => {
    const data = (await act("slots", { action: "slots" })) as { text: string } | null;
    if (!data) return;
    if (!data.text) toast("No hay horas libres en tu horario de citas.", "info");
    else setText((t) => (t.trim() ? `${t}\n\n${data.text}` : data.text));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabecera */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onBack} aria-label="Volver">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{chat.name}</span>
            <button
              type="button"
              aria-label={chat.priority ? "Quitar prioridad" : "Marcar prioritario"}
              onClick={() => act("priority", { action: "priority", on: !chat.priority })}
              disabled={!canWrite}
            >
              <Star className={cn("size-4", chat.priority ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} />
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>+{chat.phone}</span>
            {chat.contactId && (
              <Link href={`/admin/contacts/${chat.contactId}`} className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline">
                <UserRound className="size-3" /> Ficha
              </Link>
            )}
          </div>
        </div>
        <ModeSwitch
          mode={chat.aiMode}
          disabled={!canWrite || busy !== null}
          onChange={(mode) => act("mode", { action: "mode", mode }, MODE_LABEL[mode])}
        />
        {chat.aiMode === "MANUAL" || chat.priority ? (
          <Button size="sm" variant="outline" disabled={!canWrite || busy !== null} onClick={() => act("release", { action: "release" }, "La IA vuelve a atender este chat")}>
            <Bot /> Devolver a la IA
          </Button>
        ) : (
          <Button size="sm" disabled={!canWrite || busy !== null} onClick={() => act("take", { action: "take" }, "Chat tuyo: la IA no escribe aquí")} className="bg-[#128c4a] hover:bg-[#0f7a40]">
            <Hand /> Tomar este chat
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setShowInfo((v) => !v)} className="lg:hidden">
          Ficha IA
        </Button>
      </div>

      {/* Estado de la IA en este chat */}
      {chat.escalation ? (
        <div className={cn("flex flex-wrap items-center gap-2 px-3 py-2 text-sm", chat.escalation.severity === "urgent" ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100" : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100")}>
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <strong>{chat.escalation.severity === "urgent" ? "URGENTE · " : ""}{CATEGORY_LABEL[chat.escalation.category ?? ""] ?? "Te toca"}:</strong>{" "}
            {chat.escalation.reason}
          </span>
          <Button size="xs" variant="outline" disabled={!canWrite || busy !== null} onClick={() => act("resume", { action: "resume" }, "La IA vuelve a responder aquí")}>
            <RotateCcw /> Ya lo resolví, que siga la IA
          </Button>
        </div>
      ) : (
        <div className={cn("flex items-center gap-2 border-b border-border/60 px-3 py-1.5", live && "bg-sky-50/70 dark:bg-sky-950/30")}>
          {lastRun ? <RunStatus run={lastRun} /> : <span className="text-xs text-muted-foreground">La IA aún no ha mirado este chat.</span>}
          <span className="ml-auto text-[11px] text-muted-foreground">{MODE_LABEL[chat.aiMode]}{chat.paused ? " · en pausa" : ""}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Mensajes */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-[#efeae2] px-3 py-3 dark:bg-muted/30">
            {chat.messages.map((m) => {
              const out = m.direction === "OUTBOUND";
              return (
                <div key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm",
                      out ? (m.isAutoReply ? "bg-[#d9fdd3] ring-1 ring-sky-300/70 dark:bg-emerald-900/50" : "bg-[#d9fdd3] dark:bg-emerald-900/50") : "bg-white dark:bg-card",
                      m.status === "FAILED" && "opacity-60 ring-1 ring-red-400"
                    )}
                  >
                    {m.attachments.map((a, i) =>
                      a.url && a.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={a.url} alt={a.caption ?? "imagen"} className="mb-1 max-h-60 rounded" />
                      ) : (
                        <a key={i} href={a.url ?? undefined} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-1 text-xs underline">
                          <Paperclip className="size-3" /> {a.kind}
                        </a>
                      )
                    )}
                    {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                    <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                      {m.isAutoReply && <span className="inline-flex items-center gap-0.5 font-medium text-sky-700"><Bot className="size-3" />IA</span>}
                      {m.isEcho && <span className="inline-flex items-center gap-0.5"><Smartphone className="size-3" />celular</span>}
                      {m.staffName && !m.isAutoReply && <span>{m.staffName}</span>}
                      <span>{new Date(m.sentAt).toLocaleString("es-CO", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" })}</span>
                      {m.status === "FAILED" && <span className="text-red-600">no enviado</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          {/* Redactar */}
          <div className="space-y-2 border-t border-border p-2">
            {!chat.windowOpen && (
              <p className="text-xs text-amber-700">Pasaron más de 24 h desde su último mensaje: WhatsApp solo deja escribir cuando ella vuelva a escribir.</p>
            )}
            {chat.draft?.source === "AI" && text === chat.draft.body && (
              <p className="flex items-center gap-1 text-xs text-violet-700"><Sparkles className="size-3.5" /> Borrador de la IA: revísalo y envíalo, o cámbialo (la IA aprende de tus cambios).</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              <Button size="xs" variant="outline" disabled={!canWrite || busy !== null} onClick={suggest}>
                {busy === "suggest" ? <Loader2 className="animate-spin" /> : <Sparkles />} Que la IA proponga
              </Button>
              <Button size="xs" variant="outline" disabled={!canWrite || busy !== null} onClick={slots}>
                {busy === "slots" ? <Loader2 className="animate-spin" /> : <CalendarClock />} Horas libres
              </Button>
              {QUICK_REPLIES.map((q) => (
                <Button key={q} size="xs" variant="ghost" className="max-w-[14rem] truncate" onClick={() => setText(q)} disabled={!canWrite}>
                  {q}
                </Button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={canWrite ? "Escribe tu respuesta…" : "Solo lectura"}
                disabled={!canWrite}
                rows={2}
                className="min-h-[2.75rem] flex-1 resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <Button onClick={send} disabled={!canWrite || !text.trim() || busy !== null || !chat.windowOpen} className="bg-[#128c4a] hover:bg-[#0f7a40]" aria-label="Enviar">
                {busy === "send" ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </div>
            {chat.aiMode === "AUTO" && !chat.paused && (
              <p className="text-[11px] text-muted-foreground">Si escribes aquí, la IA se aparta de este chat por unas horas.</p>
            )}
          </div>
        </div>

        {/* Ficha de la IA */}
        <aside className={cn("w-72 shrink-0 space-y-4 overflow-y-auto border-l border-border p-3 text-sm", showInfo ? "block" : "hidden lg:block")}>
          <section className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lo que la IA recuerda</h3>
            <Textarea value={memory} onChange={(e) => setMemory(e.target.value)} rows={6} placeholder="Aún nada. La IA la escribe al conversar; también puedes escribirla tú." disabled={!canWrite} className="text-xs" />
            <Button size="xs" variant="outline" disabled={!canWrite || memory === (chat.memory?.notes ?? "") || busy !== null} onClick={() => act("memory", { action: "memory", notes: memory }, "Guardado")}>
              Guardar
            </Button>
          </section>

          {chat.bookings.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Citas que agendó la IA</h3>
              {chat.bookings.map((b) => (
                <div key={b.id} className="rounded-md border border-border p-2 text-xs">
                  <div className="font-medium">{b.service}</div>
                  <div>{new Date(b.startsAt).toLocaleString("es-CO", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}</div>
                  {b.meetUrl && <a href={b.meetUrl} target="_blank" rel="noreferrer" className="text-sky-700 underline">Meet</a>}
                </div>
              ))}
            </section>
          )}

          <section className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lo que hizo la IA aquí</h3>
            {chat.runs.length === 0 && <p className="text-xs text-muted-foreground">Nada todavía.</p>}
            {chat.runs.slice(0, 8).map((r) => {
              const tools = Array.isArray(r.toolCalls) ? (r.toolCalls as { tool: string }[]).map((t) => t.tool) : [];
              return (
                <div key={r.id} className="space-y-0.5 border-b border-border/50 pb-1.5">
                  <RunStatus run={r} />
                  <div className="text-[11px] text-muted-foreground">
                    {agoLabel(r.queuedAt, now)}
                    {tools.length > 0 && ` · usó: ${[...new Set(tools)].join(", ")}`}
                  </div>
                  {r.reason && r.status !== "SKIPPED" && <div className="text-[11px]">{r.reason}</div>}
                </div>
              );
            })}
          </section>
        </aside>
      </div>
    </div>
  );
};

const WhatsAppChatsClient = ({ initialConversationId }: { initialConversationId: string | null }) => {
  const { canWrite, toast } = useCrm();
  const [queue, setQueue] = useState<ChatQueue>("all");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ChatListItem[] | null>(null);
  const [counts, setCounts] = useState<Counts>({ attention: 0, mine: 0, ai: 0, unread: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId);
  const [chat, setChat] = useState<ChatDetail | null>(null);
  const queueRef = useRef(queue);
  const qRef = useRef(q);
  const selectedRef = useRef(selectedId);
  queueRef.current = queue;
  qRef.current = q;
  selectedRef.current = selectedId;

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

  const loadChat = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/admin/whatsapp/chats/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as ChatDetail;
      if (selectedRef.current === id) setChat(data);
    } catch {
      toast("No se pudo abrir el chat.", "error");
    }
  }, [toast]);

  // Primera carga: si hay algo en «Te toca», se abre ahí.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/whatsapp/chats?queue=attention", { cache: "no-store" }).catch(() => null);
      const data = res?.ok ? ((await res.json()) as { counts: Counts }) : null;
      if (data && data.counts.attention > 0) {
        queueRef.current = "attention";
        setQueue("attention");
      }
      await loadList();
    })();
  }, [loadList]);

  useEffect(() => {
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

  // Mientras la IA trabaja, el reloj de la lista avanza (lo pinta RunStatus).
  const anyLive = useMemo(() => (items ?? []).some((i) => isRunLive(i.lastRun)), [items]);
  useNow(anyLive);

  const refresh = () => {
    void loadList();
    if (selectedId) void loadChat(selectedId);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Lista */}
      <div className={cn("flex w-full min-w-0 flex-col border-r border-border md:w-[22rem] md:shrink-0", selectedId && "hidden md:flex")}>
        <div className="space-y-2 border-b border-border p-2">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-full bg-[#25d366] text-white">
              <Bot className="size-4" />
            </span>
            <h1 className="text-base font-semibold">WhatsApp</h1>
            {counts.unread > 0 && <Badge variant="secondary">{counts.unread} sin leer</Badge>}
          </div>
          <div className="grid grid-cols-4 gap-1">
            {QUEUES.map((qq) => {
              const n = qq.id === "attention" ? counts.attention : qq.id === "mine" ? counts.mine : qq.id === "ai" ? counts.ai : null;
              return (
                <button
                  key={qq.id}
                  type="button"
                  title={qq.hint}
                  onClick={() => {
                    queueRef.current = qq.id;
                    setQueue(qq.id);
                    void loadList();
                  }}
                  className={cn(
                    "flex flex-col items-center rounded-md px-1 py-1 text-[11px] leading-tight transition-colors",
                    queue === qq.id ? "bg-foreground text-background" : "bg-muted/60 hover:bg-muted",
                    qq.id === "attention" && (n ?? 0) > 0 && queue !== qq.id && "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                  )}
                >
                  <span className="font-medium">{qq.label}</span>
                  {n !== null && <span className="text-[10px] opacity-80">{n}</span>}
                </button>
              );
            })}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void loadList()}
              onBlur={() => void loadList()}
              placeholder="Buscar nombre o número"
              className="h-8 pl-7 text-sm"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items === null && <div className="p-4 text-sm text-muted-foreground">Cargando…</div>}
          {items?.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {queue === "attention" ? "Nada pendiente: la IA no te ha pasado ningún chat." : "No hay chats aquí."}
            </div>
          )}
          {items?.map((item) => (
            <ChatRow key={item.id} item={item} active={item.id === selectedId} onOpen={() => setSelectedId(item.id)} />
          ))}
        </div>
      </div>

      {/* Chat */}
      <div className={cn("min-w-0 flex-1", !selectedId && "hidden md:block")}>
        {!selectedId && (
          <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">
            Elige un chat. En «Te toca» están los que la IA te pasó; en «Tú atiendes», los que tomaste.
          </div>
        )}
        {selectedId && !chat && (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
        {chat && (
          <Thread
            key={chat.id}
            chat={chat}
            canWrite={canWrite}
            onBack={() => setSelectedId(null)}
            onChanged={refresh}
          />
        )}
      </div>
    </div>
  );
};

export default WhatsAppChatsClient;
