import type { FeedStreamEvent } from "./types";

/**
 * Stream SSE del contador del feed.
 *
 * El cliente no recibe la lista de notificaciones por aquí: recibe solo
 * `{ unread, latestAt }`. Cuando ese par cambia, el cliente decide si recarga
 * la lista. Así el stream es barato y no depende del tamaño del feed.
 */

const DEFAULT_INTERVAL_MS = 15_000;
/**
 * Por debajo de `maxDuration = 300` de la ruta: preferimos cerrar nosotros con
 * un handoff limpio a que la plataforma corte la invocación a mitad de frame.
 */
const DEFAULT_TTL_MS = 285_000;
const RETRY_MS = 5_000;

const snapshotId = (event: FeedStreamEvent) =>
  `${event.latestAt}:${event.unread}`;

/** `Last-Event-ID` con formato `<latestAtMs>:<unread>`. */
const parseLastEventId = (raw?: string): FeedStreamEvent | null => {
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length !== 2) return null;
  const [rawLatest, rawUnread] = parts;
  if (rawLatest.trim() === "" || rawUnread.trim() === "") return null;
  const latestAt = Number(rawLatest);
  const unread = Number(rawUnread);
  if (!Number.isFinite(latestAt) || !Number.isFinite(unread)) return null;
  return { latestAt, unread };
};

const sameSnapshot = (
  a: FeedStreamEvent | null,
  b: FeedStreamEvent | null
): boolean =>
  a !== null && b !== null && a.unread === b.unread && a.latestAt === b.latestAt;

const dataFrame = (event: FeedStreamEvent): string =>
  `id: ${snapshotId(event)}\nretry: ${RETRY_MS}\ndata: ${JSON.stringify(event)}\n\n`;

/** Cabeceras obligatorias para que Vercel no bufferice el stream. */
export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export type FeedStreamOptions = {
  /** Sondeo del estado actual. Debe ser una única consulta agregada. */
  poll: () => Promise<FeedStreamEvent>;
  /** `request.signal`. Sin esto el intervalo sobrevive al cliente. */
  signal: AbortSignal;
  intervalMs?: number;
  ttlMs?: number;
  /** Cabecera `Last-Event-ID` de la reconexión del EventSource. */
  lastEventId?: string;
};

export const createFeedStream = (
  opts: FeedStreamOptions
): ReadableStream<Uint8Array> => {
  const {
    poll,
    signal,
    intervalMs = DEFAULT_INTERVAL_MS,
    ttlMs = DEFAULT_TTL_MS,
    lastEventId,
  } = opts;

  const encoder = new TextEncoder();

  let interval: ReturnType<typeof setInterval> | null = null;
  let ttlTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  // Lo que el cliente ya sabe. En una reconexión viene del Last-Event-ID, así
  // que no le reenviamos un frame que provocaría un refetch inútil.
  let last: FeedStreamEvent | null = parseLastEventId(lastEventId);

  const onAbort = () => close();

  /**
   * Todo cierre pasa por aquí. Limpiar el intervalo es lo único que impide que
   * una instancia de Fluid Compute quede fijada facturando después de que el
   * navegador se haya ido.
   */
  function close() {
    if (closed) return;
    closed = true;
    if (interval) clearInterval(interval);
    if (ttlTimer) clearTimeout(ttlTimer);
    interval = null;
    ttlTimer = null;
    signal.removeEventListener("abort", onAbort);
    try {
      ctrl?.close();
    } catch {
      // Ya cerrado por el consumidor: nada que hacer.
    }
    ctrl = null;
  }

  // Encolar sobre un controller cerrado lanza; nunca debe tumbar la ruta.
  const send = (chunk: string): boolean => {
    if (closed || !ctrl) return false;
    try {
      ctrl.enqueue(encoder.encode(chunk));
      return true;
    } catch {
      close();
      return false;
    }
  };

  const safePoll = async (): Promise<FeedStreamEvent | null> => {
    try {
      return await poll();
    } catch {
      // Un fallo puntual de la base de datos no debe cerrar la conexión: el
      // siguiente tick reintenta.
      return null;
    }
  };

  const tick = async () => {
    if (closed) return;
    const current = await safePoll();
    if (closed) return;
    if (!current || sameSnapshot(current, last)) {
      send(": ping\n\n");
      return;
    }
    last = current;
    send(dataFrame(current));
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;

      if (signal.aborted) {
        close();
        return;
      }
      signal.addEventListener("abort", onAbort);

      // Fija el intervalo de reconexión aunque el primer sondeo no cambie nada.
      send(`retry: ${RETRY_MS}\n\n`);

      void tick();

      interval = setInterval(() => {
        void tick();
      }, intervalMs);

      // Handoff planificado: cerramos limpio y el EventSource del navegador
      // reconecta solo con `Last-Event-ID`. No es un error.
      ttlTimer = setTimeout(() => {
        send(": closing\n\n");
        close();
      }, ttlMs);
    },

    cancel() {
      // El consumidor se fue (pestaña cerrada). En Node el `abort` del request
      // suele llegar igual, pero no está garantizado en todos los runtimes.
      close();
    },
  });
};
