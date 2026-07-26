"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FeedItem,
  FeedMutation,
  FeedResponse,
  FeedStreamEvent,
} from "@/lib/notifications/platform/types";

/**
 * Estado del feed de notificaciones para cualquier superficie (CRM o portal de
 * miembros). No conoce ninguna ruta: `feedUrl` y `streamUrl` entran por props.
 *
 * Tres cosas que no son obvias y que son la razón de ser de este archivo:
 *
 * 1. **Elección de líder por BroadcastChannel.** Solo UNA pestaña abre el
 *    EventSource y reparte los frames al resto. Sin esto cada pestaña abierta
 *    del CRM fija su propia función serverless durante cinco minutos, y se
 *    factura por todas.
 * 2. **Puerta de visibilidad.** Una pestaña oculta cierra el stream y renuncia
 *    al liderazgo; al volver a verse hace un GET puntual y vuelve a la
 *    elección. Nadie paga por pestañas de fondo.
 * 3. **Interruptor de emergencia.** Con `streamEnabled: false` no se abre
 *    ningún EventSource ni BroadcastChannel: se degrada a sondeo cada 60 s.
 *    Es la salida si el coste del SSE se vuelve un problema en producción.
 */

const HEARTBEAT_MS = 3_000;
/** Sin latido del líder en este plazo, cualquier pestaña puede reclamar. */
const LEADER_TIMEOUT_MS = 8_000;
/** Espera tras el sondeo inicial antes de reclamar el liderazgo. */
const PROBE_WAIT_MS = 500;
const DEFAULT_POLL_MS = 60_000;

type ChannelMessage =
  | { type: "probe"; id: string }
  | { type: "heartbeat"; id: string; ticket: number }
  | { type: "resign"; id: string }
  | { type: "event"; id: string; payload: FeedStreamEvent };

export type NotificationFeedOptions = {
  /** GET para listar, POST para mutar. */
  feedUrl: string;
  /** Endpoint SSE del contador. */
  streamUrl: string;
  /** false ⇒ nada de SSE; sondeo cada `pollIntervalMs`. */
  streamEnabled: boolean;
  /** false ⇒ el hook no hace ninguna petición (vista previa, sesión ausente). */
  enabled?: boolean;
  /** Nombre del BroadcastChannel. Por defecto se deriva de `streamUrl`. */
  channelName?: string;
  pollIntervalMs?: number;
  /**
   * Se llama con los elementos que aparecieron después de la carga inicial.
   * Sirve para, por ejemplo, sacar un toast en los de severidad ERROR.
   */
  onNewItems?: (items: FeedItem[]) => void;
};

export type NotificationFeed = {
  items: FeedItem[];
  unread: number;
  /** Carga inicial (o recarga completa al cambiar de pestaña del filtro). */
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  unreadOnly: boolean;
  setUnreadOnly: (value: boolean) => void;
  loadMore: () => void;
  refresh: () => void;
  markRead: (ids: string[]) => Promise<boolean>;
  markAllRead: () => Promise<boolean>;
  dismiss: (ids: string[]) => Promise<boolean>;
  /** true mientras esta pestaña es la que sostiene el EventSource. */
  isStreamLeader: boolean;
};

const withQuery = (url: string, params: Record<string, string | undefined>) => {
  const qs = Object.entries(params)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  if (!qs) return url;
  return url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
};

const latestOf = (items: readonly FeedItem[]): number =>
  items.reduce((max, item) => {
    const ms = new Date(item.createdAt).getTime();
    return Number.isNaN(ms) ? max : Math.max(max, ms);
  }, 0);

const useNotificationFeed = ({
  feedUrl,
  streamUrl,
  streamEnabled,
  enabled = true,
  channelName,
  pollIntervalMs = DEFAULT_POLL_MS,
  onNewItems,
}: NotificationFeedOptions): NotificationFeed => {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnlyState] = useState(false);
  const [isStreamLeader, setIsStreamLeader] = useState(false);

  // Espejos de estado para los callbacks asíncronos y los efectos de red, que
  // no pueden depender del `items`/`unread` de un render concreto.
  const itemsRef = useRef<FeedItem[]>(items);
  const unreadRef = useRef(unread);
  const unreadOnlyRef = useRef(unreadOnly);
  const cursorRef = useRef<string | null>(nextCursor);
  const onNewItemsRef = useRef(onNewItems);
  const mountedRef = useRef(true);
  /** Descarta respuestas de peticiones que ya quedaron obsoletas. */
  const requestSeqRef = useRef(0);
  /** Última marca de tiempo conocida del feed; dispara la recarga por SSE. */
  const latestAtRef = useRef(0);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    unreadRef.current = unread;
  }, [unread]);
  useEffect(() => {
    unreadOnlyRef.current = unreadOnly;
  }, [unreadOnly]);
  useEffect(() => {
    cursorRef.current = nextCursor;
  }, [nextCursor]);
  useEffect(() => {
    onNewItemsRef.current = onNewItems;
  }, [onNewItems]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Carga una página. `cursor === null` reemplaza la lista; si no, la extiende. */
  const load = useCallback(
    async (cursor: string | null, opts?: { silent?: boolean }) => {
      if (!enabled || typeof window === "undefined") return;
      const seq = ++requestSeqRef.current;
      const append = cursor !== null;
      if (append) setLoadingMore(true);
      else if (!opts?.silent) setLoading(true);

      try {
        const res = await fetch(
          withQuery(feedUrl, {
            cursor: cursor ?? undefined,
            unreadOnly: unreadOnlyRef.current ? "true" : undefined,
          }),
          { headers: { Accept: "application/json" }, cache: "no-store" }
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as FeedResponse;
        // Una respuesta vieja no puede pisar a una más nueva.
        if (!mountedRef.current || seq !== requestSeqRef.current) return;

        // Se calcula fuera del updater: `setItems` tiene que ser puro.
        const fresh = data.items.filter(
          (item) => !seenIdsRef.current.has(item.id)
        );
        for (const item of data.items) seenIdsRef.current.add(item.id);
        if (seenIdsRef.current.size > 1000) {
          seenIdsRef.current = new Set(data.items.map((item) => item.id));
        }

        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        if (primedRef.current && fresh.length > 0) {
          onNewItemsRef.current?.(fresh);
        }
        primedRef.current = true;
        setUnread(data.unread);
        setNextCursor(data.nextCursor);
        cursorRef.current = data.nextCursor;
        latestAtRef.current = Math.max(
          latestAtRef.current,
          latestOf(data.items)
        );
        setError(null);
      } catch {
        if (!mountedRef.current || seq !== requestSeqRef.current) return;
        setError("No se pudieron cargar las notificaciones");
      } finally {
        if (mountedRef.current && seq === requestSeqRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [enabled, feedUrl]
  );

  const refresh = useCallback(() => {
    void load(null, { silent: true });
  }, [load]);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    void load(cursor);
  }, [load]);

  const setUnreadOnly = useCallback((value: boolean) => {
    setUnreadOnlyState(value);
    unreadOnlyRef.current = value;
  }, []);

  // Carga inicial y recarga al cambiar el filtro. Va por temporizador para que
  // el `setLoading(true)` de `load` no quede en el camino síncrono del efecto
  // (react-hooks/set-state-in-effect) y para poder cancelarlo al desmontar.
  useEffect(() => {
    if (!enabled) return;
    cursorRef.current = null;
    const timer = setTimeout(() => void load(null), 0);
    return () => clearTimeout(timer);
  }, [enabled, load, unreadOnly]);

  /** Mutación optimista con reversión si el servidor falla. */
  const mutate = useCallback(
    async (
      mutation: FeedMutation,
      optimistic: (prev: readonly FeedItem[]) => FeedItem[]
    ): Promise<boolean> => {
      if (!enabled || typeof window === "undefined") return false;
      const prevItems = itemsRef.current;
      const prevUnread = unreadRef.current;

      const nextItems = optimistic(prevItems);
      setItems(nextItems);
      // El contador solo se puede estimar con lo que hay cargado, así que se
      // mueve por diferencia (descartar implica leer, ver feed.ts). La respuesta
      // del servidor trae el valor autoritativo y lo corrige enseguida.
      const countUnread = (list: readonly FeedItem[]) =>
        list.filter((item) => item.readAt === null).length;
      const delta = countUnread(prevItems) - countUnread(nextItems);
      setUnread(Math.max(0, prevUnread - delta));

      try {
        const res = await fetch(feedUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mutation),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { unread?: number };
        if (!mountedRef.current) return true;
        if (typeof data.unread === "number") setUnread(data.unread);
        return true;
      } catch {
        if (!mountedRef.current) return false;
        setItems(prevItems);
        setUnread(prevUnread);
        return false;
      }
    },
    [enabled, feedUrl]
  );

  const markRead = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return Promise.resolve(true);
      const now = new Date().toISOString();
      const target = new Set(ids);
      return mutate({ action: "read", ids }, (prev) =>
        prev.map((item) =>
          target.has(item.id) && item.readAt === null
            ? { ...item, readAt: now }
            : item
        )
      );
    },
    [mutate]
  );

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    return mutate({ action: "read_all" }, (prev) =>
      prev.map((item) => (item.readAt === null ? { ...item, readAt: now } : item))
    );
  }, [mutate]);

  const dismiss = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return Promise.resolve(true);
      const target = new Set(ids);
      return mutate({ action: "dismiss", ids }, (prev) =>
        prev.filter((item) => !target.has(item.id))
      );
    },
    [mutate]
  );

  /** Aplica un frame del stream, venga del EventSource o de otra pestaña. */
  const applyStreamEvent = useCallback(
    (event: FeedStreamEvent) => {
      if (!mountedRef.current) return;
      setUnread(event.unread);
      if (event.latestAt > latestAtRef.current) {
        latestAtRef.current = event.latestAt;
        // Solo la primera página: lo que el usuario ve arriba es lo nuevo.
        void load(null, { silent: true });
      }
    },
    [load]
  );
  const applyStreamEventRef = useRef(applyStreamEvent);
  useEffect(() => {
    applyStreamEventRef.current = applyStreamEvent;
  }, [applyStreamEvent]);

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // ── Stream SSE con elección de líder ──────────────────────────────────────
  useEffect(() => {
    if (!enabled || !streamEnabled || typeof window === "undefined") return;
    if (typeof EventSource === "undefined") return;

    const selfId = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    // Ticket más bajo gana. El id desempata para que la decisión sea la misma
    // en todas las pestañas.
    const ticket = Math.random();
    const name = channelName ?? `notif-feed:${streamUrl}`;

    let channel: BroadcastChannel | null = null;
    try {
      channel =
        typeof BroadcastChannel === "undefined"
          ? null
          : new BroadcastChannel(name);
    } catch {
      channel = null;
    }

    let source: EventSource | null = null;
    let leader = false;
    let leaderSeenAt = 0;
    let leaderTicket = Number.POSITIVE_INFINITY;
    let leaderId = "";
    let disposed = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let probeTimer: ReturnType<typeof setTimeout> | null = null;
    let electionTimer: ReturnType<typeof setTimeout> | null = null;

    const post = (message: ChannelMessage) => {
      try {
        channel?.postMessage(message);
      } catch {
        // Canal cerrado por el navegador: seguimos en modo pestaña única.
      }
    };

    const closeStream = () => {
      source?.close();
      source = null;
    };

    const openStream = () => {
      if (disposed || source) return;
      const es = new EventSource(streamUrl);
      source = es;
      es.onmessage = (ev: MessageEvent<string>) => {
        let payload: FeedStreamEvent | null = null;
        try {
          payload = JSON.parse(ev.data) as FeedStreamEvent;
        } catch {
          return;
        }
        if (
          !payload ||
          typeof payload.unread !== "number" ||
          typeof payload.latestAt !== "number"
        ) {
          return;
        }
        applyStreamEventRef.current(payload);
        post({ type: "event", id: selfId, payload });
      };
      // El navegador reconecta solo con Last-Event-ID; no cerramos aquí.
      es.onerror = () => {};
    };

    const resign = (broadcast: boolean) => {
      if (!leader) return;
      leader = false;
      closeStream();
      if (mountedRef.current) setIsStreamLeader(false);
      if (broadcast) post({ type: "resign", id: selfId });
    };

    const claim = () => {
      if (disposed || leader) return;
      leader = true;
      leaderSeenAt = Date.now();
      leaderTicket = ticket;
      leaderId = selfId;
      if (mountedRef.current) setIsStreamLeader(true);
      post({ type: "heartbeat", id: selfId, ticket });
      openStream();
    };

    const runElection = () => {
      if (disposed) return;
      if (document.hidden) {
        resign(true);
        return;
      }
      if (leader) return;
      if (Date.now() - leaderSeenAt < LEADER_TIMEOUT_MS) return;
      claim();
    };

    const scheduleElection = (delay: number) => {
      if (electionTimer) clearTimeout(electionTimer);
      electionTimer = setTimeout(runElection, delay);
    };

    const onMessage = (ev: MessageEvent<ChannelMessage>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object" || msg.id === selfId) return;

      if (msg.type === "probe") {
        if (leader) post({ type: "heartbeat", id: selfId, ticket });
        return;
      }
      if (msg.type === "heartbeat") {
        leaderSeenAt = Date.now();
        leaderTicket = msg.ticket;
        leaderId = msg.id;
        // Dos líderes a la vez (carrera al abrir dos pestañas): el ticket más
        // bajo se queda; el id desempata un empate exacto.
        if (
          leader &&
          (msg.ticket < ticket || (msg.ticket === ticket && msg.id < selfId))
        ) {
          resign(false);
        }
        return;
      }
      if (msg.type === "resign") {
        if (leaderId === msg.id || leaderTicket !== Number.POSITIVE_INFINITY) {
          leaderSeenAt = 0;
        }
        // Jitter para que dos seguidores no reclamen a la vez.
        scheduleElection(Math.random() * 250);
        return;
      }
      if (msg.type === "event") {
        applyStreamEventRef.current(msg.payload);
      }
    };

    if (channel) channel.onmessage = onMessage;

    const onVisibility = () => {
      if (document.hidden) {
        resign(true);
        return;
      }
      // Al volver: un GET puntual pone al día lo que nos perdimos, y luego
      // volvemos a entrar en la elección.
      refreshRef.current();
      post({ type: "probe", id: selfId });
      scheduleElection(PROBE_WAIT_MS);
    };

    const onPageHide = () => resign(true);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    // Sondeamos primero: si ya hay líder responderá con un latido antes de que
    // venza `PROBE_WAIT_MS` y esta pestaña no abrirá nada. Sin canal no hay a
    // quién preguntar, pero la elección sigue yendo por temporizador para no
    // llamar a setState de forma síncrona dentro del efecto.
    if (channel) post({ type: "probe", id: selfId });
    probeTimer = setTimeout(runElection, channel ? PROBE_WAIT_MS : 0);

    heartbeat = setInterval(() => {
      if (disposed) return;
      if (leader) {
        if (document.hidden) {
          resign(true);
          return;
        }
        post({ type: "heartbeat", id: selfId, ticket });
        return;
      }
      runElection();
    }, HEARTBEAT_MS);

    return () => {
      disposed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (probeTimer) clearTimeout(probeTimer);
      if (electionTimer) clearTimeout(electionTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      resign(true);
      closeStream();
      if (channel) {
        channel.onmessage = null;
        channel.close();
      }
    };
  }, [enabled, streamEnabled, streamUrl, channelName]);

  // ── Interruptor de emergencia: sondeo periódico sin SSE ────────────────────
  useEffect(() => {
    if (!enabled || streamEnabled || typeof window === "undefined") return;

    const timer = setInterval(() => {
      if (document.hidden) return;
      refreshRef.current();
    }, pollIntervalMs);

    const onVisibility = () => {
      if (!document.hidden) refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, streamEnabled, pollIntervalMs]);

  return {
    items,
    unread,
    loading,
    loadingMore,
    error,
    hasMore: nextCursor !== null,
    unreadOnly,
    setUnreadOnly,
    loadMore,
    refresh,
    markRead,
    markAllRead,
    dismiss,
    isStreamLeader,
  };
};

export default useNotificationFeed;
