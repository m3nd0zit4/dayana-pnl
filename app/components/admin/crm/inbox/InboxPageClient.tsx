"use client";

import { AtSign, MessageCircle, MessagesSquare, Send, Sparkles, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import CrmPageShell from "../CrmPageShell";
import type {
  ConversationDetailView,
  ConversationListItem,
  InboxChannel,
} from "./types";
import { CHANNEL_LABEL } from "./types";

type Props = {
  initialItems: ConversationListItem[];
  initialCursor: string | null;
  canWrite: boolean;
  streamEnabled: boolean;
};

// lucide ya no publica iconos de marca, así que se usan genéricos distinguibles.
const CHANNEL_ICON: Record<InboxChannel, typeof MessageCircle> = {
  WHATSAPP: MessageCircle,
  MESSENGER: MessagesSquare,
  INSTAGRAM: AtSign,
};

const relativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
};

const participantLabel = (item: ConversationListItem): string =>
  item.contact?.displayName ??
  (item.contact
    ? `${item.contact.firstName} ${item.contact.lastName ?? ""}`.trim()
    : null) ??
  item.participantName ??
  item.participantHandle ??
  item.externalThreadId;

const InboxPageClient = ({
  initialItems,
  initialCursor,
  canWrite,
  streamEnabled,
}: Props) => {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetailView | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<InboxChannel | "ALL">("ALL");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sin filtro de canal en el servidor: el filtrado se hace en cliente sobre la
  // lista ya cargada, así que pedirlo otra vez al cambiar de pestaña sería un
  // viaje de ida y vuelta para nada.
  const refreshList = useCallback(async () => {
    const res = await fetch("/api/admin/inbox", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      items: ConversationListItem[];
      nextCursor: string | null;
    };
    setItems(data.items);
    setCursor(data.nextCursor);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/admin/inbox/${id}`, { cache: "no-store" });
    if (!res.ok) {
      setError("No se pudo abrir la conversación.");
      return;
    }
    const data = (await res.json()) as ConversationDetailView;
    setDetail(data);
    setDraft(data.draftBody ?? "");
    setError(null);
    // Abrir el hilo lo marca leído en el servidor; se refleja aquí sin recargar.
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, unreadCount: 0 } : item))
    );
  }, []);

  // Abrir un hilo es una acción del usuario, no un efecto derivado del estado:
  // hacerlo aquí evita el render en cascada de cargar dentro de un useEffect.
  const selectThread = useCallback(
    (id: string) => {
      setSelectedId(id);
      void loadDetail(id);
    },
    [loadDetail]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages.length]);

  /**
   * El stream solo trae `{ unread, latestAt }`. Cuando ese par cambia se
   * recarga la lista y, si hay un hilo abierto, ese hilo — así el stream no
   * crece con el tamaño de la bandeja.
   */
  useEffect(() => {
    if (!streamEnabled) return;

    const source = new EventSource("/api/admin/inbox/stream");
    source.onmessage = () => {
      void refreshList();
      if (selectedId) void loadDetail(selectedId);
    };
    // Un error de red no debe cerrar el EventSource: el navegador reconecta
    // solo usando el `retry` que manda el servidor.
    source.onerror = () => undefined;

    return () => source.close();
  }, [streamEnabled, refreshList, loadDetail, selectedId]);

  const send = async () => {
    if (!selectedId || !draft.trim() || sending) return;
    setSending(true);
    setError(null);

    const res = await fetch(`/api/admin/inbox/${selectedId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: draft }),
    });

    if (res.ok) {
      setDraft("");
      await loadDetail(selectedId);
      await refreshList();
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "No se pudo enviar el mensaje.");
    }
    setSending(false);
  };

  const filtered = useMemo(
    () =>
      channelFilter === "ALL"
        ? items
        : items.filter((item) => item.channel === channelFilter),
    [items, channelFilter]
  );

  const windowBlocked = detail?.window.requirement === "closed";
  const needsTemplate = detail?.window.requirement === "template";
  const composerDisabled =
    !canWrite || sending || windowBlocked || needsTemplate;

  return (
    <CrmPageShell>
      <header className="pb-4">
        <h1 className="text-xl font-semibold">Bandeja de entrada</h1>
        <p className="text-sm text-muted-foreground">
          WhatsApp, Instagram y Messenger en un solo lugar.
        </p>
      </header>

      <div className="flex gap-2 pb-4">
        {(["ALL", "WHATSAPP", "INSTAGRAM", "MESSENGER"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={channelFilter === value ? "default" : "outline"}
            onClick={() => setChannelFilter(value)}
          >
            {value === "ALL" ? "Todos" : CHANNEL_LABEL[value]}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Lista de hilos */}
        <div className="max-h-[70vh] space-y-1 overflow-y-auto rounded-lg border p-2">
          {filtered.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              No hay conversaciones todavía.
            </p>
          )}
          {filtered.map((item) => {
            const Icon = CHANNEL_ICON[item.channel];
            const last = item.messages[0];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectThread(item.id)}
                className={`flex w-full flex-col gap-1 rounded-md p-3 text-left transition-colors hover:bg-muted ${
                  selectedId === item.id ? "bg-muted" : ""
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
                  <span className="truncate text-sm font-medium">
                    {participantLabel(item)}
                  </span>
                  {item.unreadCount > 0 && (
                    <Badge className="ml-auto">{item.unreadCount}</Badge>
                  )}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{last?.body ?? "(adjunto)"}</span>
                  <span className="ml-auto shrink-0">
                    {relativeTime(item.lastMessageAt)}
                  </span>
                </span>
                {!item.contact && (
                  <span className="text-xs text-amber-600 dark:text-amber-500">
                    Sin contacto vinculado
                  </span>
                )}
              </button>
            );
          })}
          {cursor && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => void refreshList()}
            >
              Cargar más
            </Button>
          )}
        </div>

        {/* Hilo */}
        <div className="flex max-h-[70vh] flex-col rounded-lg border">
          {!detail && (
            <p className="p-6 text-sm text-muted-foreground">
              Elige una conversación.
            </p>
          )}

          {detail && (
            <>
              <header className="flex items-center gap-2 border-b p-3">
                <User className="size-4 opacity-70" aria-hidden />
                <span className="text-sm font-medium">
                  {detail.contact?.displayName ??
                    detail.participantName ??
                    detail.externalThreadId}
                </span>
                <Badge variant="outline" className="ml-auto">
                  {CHANNEL_LABEL[detail.channel]}
                </Badge>
              </header>

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {detail.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${
                      message.direction === "OUTBOUND"
                        ? "justify-end"
                        : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        message.direction === "OUTBOUND"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      {message.body ?? (
                        <em className="opacity-70">(adjunto)</em>
                      )}
                      {message.status === "FAILED" && (
                        <span className="mt-1 block text-xs text-destructive">
                          No se envió: {message.failedReason}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <footer className="space-y-2 border-t p-3">
                {detail.windowNotice && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    {detail.windowNotice}
                  </p>
                )}
                {detail.draftSource === "AGENT" && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Sparkles className="size-3" aria-hidden />
                    Borrador propuesto por el asistente — revísalo antes de enviar.
                  </p>
                )}
                {error && <p className="text-xs text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={
                      composerDisabled
                        ? "No se puede escribir en esta conversación."
                        : "Escribe tu respuesta…"
                    }
                    disabled={composerDisabled}
                    rows={2}
                    className="resize-none"
                  />
                  <Button
                    onClick={() => void send()}
                    disabled={composerDisabled || !draft.trim()}
                    aria-label="Enviar"
                  >
                    <Send className="size-4" aria-hidden />
                  </Button>
                </div>
              </footer>
            </>
          )}
        </div>
      </div>
    </CrmPageShell>
  );
};

export default InboxPageClient;
