"use client";

import { Bot, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSidebar } from "@/app/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { ChatDetail, ChatListItem, ChatQueue } from "@/lib/crm/whatsapp-agent/workspace";
import { useCrm } from "../crm/CrmProvider";
import ChatList, { type Counts } from "./chat/ChatList";
import ChatView from "./chat/ChatView";
import { WA_THEME } from "./chat/chatTheme";
import { post } from "./chat/utils";
import { useWhatsAppLive } from "./live";
import { isRunLive, useNow } from "./status";

/**
 * Chats de WhatsApp, con la cara de WhatsApp Web: lista a la izquierda,
 * conversación con el fondo beige (u oscuro) y burbujas verdes, barra de
 * escribir abajo. Encima de eso, lo de la IA: quién atiende cada chat, qué
 * está haciendo ahora y los botones para tomarlo o devolverlo.
 *
 * Este archivo solo carga datos y reparte: las piezas viven en `./chat/`
 * (lista, cabecera, burbujas, conversación, barra de escribir) y la paleta,
 * clara y oscura, en `./chat/chatTheme.ts`.
 */
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

  const takeRef = useRef(60);
  const [listTake, setListTake] = useState(60);
  const loadList = useCallback(async () => {
    const params = new URLSearchParams({ queue: queueRef.current, take: String(takeRef.current) });
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
    <div className={cn("flex h-full min-h-0 w-full max-w-full overflow-hidden bg-(--wa-surface)", WA_THEME)}>
      <ChatList
        items={items}
        counts={counts}
        queue={queue}
        q={q}
        selectedId={selectedId}
        canLoadMore={Boolean(items && items.length >= listTake)}
        hidden={Boolean(selectedId)}
        onQueue={pickQueue}
        onQuery={setQ}
        onSearch={() => void loadList()}
        onOpen={setSelectedId}
        onLoadMore={() => {
          takeRef.current = listTake + 60;
          setListTake(takeRef.current);
          void loadList();
        }}
        onToggleSidebar={toggleSidebar}
        onModeChanged={refresh}
      />

      {/* Conversación */}
      <div className={cn("min-w-0 flex-1", !selectedId && "hidden md:block")}>
        {!selectedId && (
          <div className="grid h-full place-items-center border-l border-(--wa-border) bg-(--wa-panel) p-8 text-center">
            <div className="max-w-sm space-y-3">
              <span className="mx-auto grid size-16 place-items-center rounded-full bg-(--wa-green-soft) text-(--wa-accent)">
                <Bot className="size-8" />
              </span>
              <h2 className="text-2xl font-light text-(--wa-heading)">WhatsApp de Dayana</h2>
              <p className="text-sm text-(--wa-meta)">
                Elige un chat. En «Te toca» están los que la IA te pasó. La ⭐ marca un chat como favorito: la IA no lo toca.
              </p>
            </div>
          </div>
        )}
        {selectedId && !chat && (
          <div className="grid h-full place-items-center border-l border-(--wa-border) bg-(--wa-chat-bg)">
            <Loader2 className="size-6 animate-spin text-(--wa-green)" />
          </div>
        )}
        {chat && (
          <ChatView
            key={chat.id}
            chat={chat}
            canWrite={canWrite}
            onBack={() => setSelectedId(null)}
            onToggleSidebar={toggleSidebar}
            onChanged={refresh}
          />
        )}
      </div>
    </div>
  );
};

export default WhatsAppChatsClient;
