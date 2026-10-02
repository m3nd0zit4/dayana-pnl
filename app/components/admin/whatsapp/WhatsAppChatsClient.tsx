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

// El chat abierto vive en la URL (`?conversation=`). Abrir uno empuja una
// entrada al historial: en el celular, «atrás» (el de Android o el del
// navegador) cierra el chat y vuelve a la lista en vez de salir de la sección.
const urlFor = (id: string | null) => {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("conversation", id);
  else url.searchParams.delete("conversation");
  return url;
};
const pushedByUs = () => Boolean((window.history.state as { waChat?: string } | null)?.waChat);

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
  // Se abre en «Te toca»: solo lo que de verdad necesita que ella conteste.
  const [queue, setQueue] = useState<ChatQueue>("attention");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ChatListItem[] | null>(null);
  const [counts, setCounts] = useState<Counts>({ attention: 0, seguimiento: 0, mine: 0, ai: 0, unread: 0 });
  const [generalMode, setGeneralMode] = useState<ChatListItem["aiMode"] | null>(null);
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
      const data = (await res.json()) as {
        items: ChatListItem[];
        counts: Counts;
        generalMode: ChatListItem["aiMode"];
      };
      setItems(data.items);
      setCounts(data.counts);
      setGeneralMode(data.generalMode);
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
  }, [selectedId, loadChat]);

  const openChat = (id: string) => {
    if (id === selectedRef.current) return;
    if (selectedRef.current) {
      // Cambiar de chat (en la computadora) no apila entradas.
      window.history.replaceState(pushedByUs() ? { waChat: id } : null, "", urlFor(id));
    } else {
      window.history.pushState({ waChat: id }, "", urlFor(id));
    }
    setSelectedId(id);
  };

  const closeChat = () => {
    // Si la entrada la pusimos nosotros, «atrás» la quita (y `popstate` cierra el chat).
    if (pushedByUs()) {
      window.history.back();
      return;
    }
    window.history.replaceState(null, "", urlFor(null));
    setSelectedId(null);
  };

  useEffect(() => {
    // Llegó con un chat abierto (un aviso, un enlace): debajo queda la lista,
    // para que «atrás» vuelva a ella.
    if (initialConversationId && !pushedByUs()) {
      window.history.replaceState(null, "", urlFor(null));
      window.history.pushState({ waChat: initialConversationId }, "", urlFor(initialConversationId));
    }
    const onPop = () => setSelectedId(new URL(window.location.href).searchParams.get("conversation"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [initialConversationId]);

  useWhatsAppLive(() => {
    void loadList();
    if (selectedRef.current) void loadChat(selectedRef.current);
  });

  // Mientras la IA trabaja en algún chat, el reloj de la lista avanza; y cada
  // minuto, para que «Te toca · hace 5 min» no se quede quieto.
  const anyLive = useMemo(() => (items ?? []).some((i) => isRunLive(i.lastRun)), [items]);
  useNow(anyLive);
  const now = useNow(true, 60_000);

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
        generalMode={generalMode}
        selectedId={selectedId}
        canLoadMore={Boolean(items && items.length >= listTake)}
        hidden={Boolean(selectedId)}
        now={now}
        onQueue={pickQueue}
        onQuery={setQ}
        onSearch={() => void loadList()}
        onOpen={openChat}
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
                Elige un chat. En «Te toca» está lo que necesita que contestes: sale en cuanto respondes (aquí o desde
                el celular) o pulsas «Listo». En «Seguimiento», quien escribió y no ha agendado ni pagado. La ⭐ marca
                un chat como favorito: la IA no lo toca.
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
            onBack={closeChat}
            onToggleSidebar={toggleSidebar}
            onChanged={refresh}
          />
        )}
      </div>
    </div>
  );
};

export default WhatsAppChatsClient;
