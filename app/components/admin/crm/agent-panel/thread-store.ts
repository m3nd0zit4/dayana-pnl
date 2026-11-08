import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { HandleMessageStreamEvent, SessionState } from "eve/client";
import type { AgentId } from "@/agent/lib/catalog";
import {
  DEFAULT_THREAD_TITLE,
  deriveTitle,
  isThreadDirty,
  normalizeThreads,
  planThreadSync,
  threadActivity,
  threadFromServer,
  type ServerThread,
  type StoredThread,
  type ThreadOpener,
} from "@/lib/agent-ui/threads";

/**
 * The panel's conversations follow the staff member across devices: the
 * server (`/api/admin/agent/threads`) is the truth, localStorage a cache so
 * render code can keep reading synchronously.
 *
 * - Every local save schedules a PUT (debounced; immediate when a turn
 *   finishes; flushed with `keepalive` when the page is hidden or closed).
 * - `syncThreads()` pulls what changed elsewhere, drops what was deleted
 *   elsewhere and uploads what only this device has (the first run migrates
 *   the old localStorage-only history). Conflict rule: the copy with more
 *   events wins (`planThreadSync`); a 409 from the server means it holds
 *   more, so its copy replaces the cache.
 * - Every change fires `THREADS_CHANGED_EVENT` so the header menu, the
 *   sidebar and the open panel re-render (`useThreadsVersion`).
 */

export type AgentThread = StoredThread<SessionState, HandleMessageStreamEvent>;

export { DEFAULT_THREAD_TITLE, deriveTitle };
export type { ThreadOpener };

export const THREADS_CHANGED_EVENT = "crm-agent-threads-changed";

const STORAGE_KEY = "crm-agent-threads";
/** Ids deleted here whose DELETE hasn't been confirmed by the server yet. */
const DELETED_KEY = "crm-agent-threads-deleted";
const API = "/api/admin/agent/threads";
const MAX_THREADS = 30;
const SAVE_DEBOUNCE_MS = 800;
const SYNC_INTERVAL_MS = 30_000;
/** Browsers cap a `keepalive` request body at 64 KiB in total. */
const KEEPALIVE_MAX_BYTES = 60_000;
const FETCH_CONCURRENCY = 3;

/** How many threads the cache holds; lowered for good if the storage quota ran out. */
let capacity = MAX_THREADS;
/** Bumped on every cache change (here or in another tab): the snapshot for `useSyncExternalStore`. */
let version = 0;

const isBrowser = () => typeof window !== "undefined";

const notify = () => {
  version += 1;
  window.dispatchEvent(new Event(THREADS_CHANGED_EVENT));
};

/** Every read goes through `normalizeThreads`, which also migrates threads saved before agents (→ "auto") or sync existed. */
const readAll = (): AgentThread[] => {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeThreads<SessionState, HandleMessageStreamEvent>(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
};

const writeAll = (threads: AgentThread[]) => {
  if (!isBrowser()) return;
  const newest = [...threads].sort((a, b) => threadActivity(b).localeCompare(threadActivity(a)));
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(newest.slice(0, capacity)));
  } catch {
    // Quota exceeded (inlined attachments are big): keep the newest half, and
    // stop trying to cache more than fits, or every sync would re-download them.
    const half = Math.max(1, Math.ceil(capacity / 2));
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(newest.slice(0, half)));
      capacity = half;
    } catch {
      // Nothing else to do: the conversation still works and lives on the server.
    }
  }
  notify();
};

/** Read-modify-write of one cached thread (synchronous, so nothing interleaves). */
const updateCached = (id: string, fn: (t: AgentThread) => AgentThread) => {
  const threads = readAll();
  const index = threads.findIndex((t) => t.id === id);
  if (index === -1) return;
  threads[index] = fn(threads[index]);
  writeAll(threads);
};

const readDeleted = (): string[] => {
  if (!isBrowser()) return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(DELETED_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

const writeDeleted = (ids: string[]) => {
  try {
    window.localStorage.setItem(DELETED_KEY, JSON.stringify(ids.slice(-100)));
  } catch {
    // Worst case a deletion that never reached the server comes back on the next sync.
  }
};

const forgetDeleted = (ids: readonly string[]) => {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  writeDeleted(readDeleted().filter((id) => !gone.has(id)));
};

export const listThreads = (): AgentThread[] =>
  readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const getThread = (id: string): AgentThread | undefined => readAll().find((t) => t.id === id);

/** The thread the assistant opened with this message, if this device has it (run `syncThreads()` first to include other devices'). */
export const findThreadByOpenerKey = (key: string): AgentThread | undefined =>
  readAll().find((t) => t.opener?.key === key);

// ── Upload ────────────────────────────────────────────────────────────────

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Map<string, Promise<void>>();
const uploadAgain = new Set<string>();

type ServerSummary = Omit<ServerThread, "session" | "events">;

/** Pulls the server's full copy into the cache. False when there's nothing to apply. */
const pullThread = async (id: string): Promise<boolean> => {
  let res: Response;
  try {
    res = await fetch(`${API}/${encodeURIComponent(id)}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    return false;
  }
  if (!res.ok) return false;
  const { thread } = (await res.json()) as { thread?: ServerThread };
  if (!thread || readDeleted().includes(id)) return false;

  const threads = readAll();
  const index = threads.findIndex((t) => t.id === id);
  const current = index === -1 ? undefined : threads[index];
  // A turn landed here while this was downloading: it goes up instead.
  if (current && current.events.length > (thread.events?.length ?? 0)) return false;
  const next = threadFromServer<SessionState, HandleMessageStreamEvent>(thread, current, Date.now());
  if (index === -1) threads.push(next);
  else threads[index] = next;
  writeAll(threads);
  return true;
};

const doUpload = async (id: string, keepalive: boolean) => {
  const thread = getThread(id);
  if (!thread || !isThreadDirty(thread)) return;
  const rev = thread.rev ?? 0;
  const body = JSON.stringify({
    agent: thread.agent,
    title: thread.title,
    ...(thread.opener ? { opener: thread.opener } : {}),
    ...(thread.session ? { session: thread.session } : {}),
    events: thread.events,
  });

  let res: Response;
  try {
    res = await fetch(`${API}/${encodeURIComponent(id)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: keepalive && body.length < KEEPALIVE_MAX_BYTES,
    });
  } catch {
    return; // Offline: it stays dirty and the next sync uploads it.
  }

  if (res.ok) {
    const { thread: saved } = (await res.json()) as { thread: ServerSummary };
    updateCached(id, (t) => ({
      ...t,
      remote: { rev, updatedAt: saved.updatedAt, eventCount: saved.eventCount, seenAt: Date.now() },
    }));
  } else if (res.status === 409) {
    // Another device went further: its copy wins.
    await pullThread(id);
  } else if (res.status === 413 || res.status === 400 || res.status === 404) {
    // Refused for good (too big, or not ours): stays on this device only until it changes.
    updateCached(id, (t) => ({ ...t, rejectedRev: rev }));
  }
  // 401/5xx: stays dirty, retried by the next sync.
};

/** One PUT per thread at a time; a save made meanwhile goes up right after. */
const uploadThread = (id: string, keepalive = false): Promise<void> => {
  const running = inflight.get(id);
  if (running) {
    uploadAgain.add(id);
    return running;
  }
  const promise = doUpload(id, keepalive).finally(() => {
    inflight.delete(id);
    if (uploadAgain.delete(id)) void uploadThread(id);
  });
  inflight.set(id, promise);
  return promise;
};

const scheduleUpload = (id: string, delay: number) => {
  const pending = saveTimers.get(id);
  if (pending) clearTimeout(pending);
  saveTimers.set(
    id,
    setTimeout(() => {
      saveTimers.delete(id);
      void uploadThread(id);
    }, delay)
  );
};

/** The page is going away (or to the background): send what's waiting now. */
const flushPendingUploads = () => {
  for (const [id, timer] of saveTimers) {
    clearTimeout(timer);
    saveTimers.delete(id);
    void uploadThread(id, true);
  }
};

const sameSession = (a: unknown, b: unknown) => {
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
};

/**
 * Creates the thread on first save, updates it on every save after. The agent
 * and the opener are set once. Like the server, the cache is append-only: a
 * save with fewer events than cached (a session mounted before newer turns
 * were pulled from another device) is ignored.
 */
export const upsertThread = (
  id: string,
  data: {
    title?: string;
    agent: AgentId;
    session?: SessionState;
    events: readonly HandleMessageStreamEvent[];
    opener?: ThreadOpener;
  },
  options?: { immediate?: boolean }
) => {
  const threads = readAll();
  const index = threads.findIndex((t) => t.id === id);
  const now = new Date().toISOString();

  if (index === -1) {
    threads.unshift({
      id,
      title: data.title ?? DEFAULT_THREAD_TITLE,
      createdAt: now,
      updatedAt: now,
      rev: 1,
      agent: data.agent,
      session: data.session,
      events: data.events,
      ...(data.opener ? { opener: data.opener } : {}),
    });
  } else {
    const current = threads[index];
    if (data.events.length < current.events.length) return;
    const title = data.title || current.title;
    const session = data.session ?? current.session;
    if (data.events.length === current.events.length && title === current.title && sameSession(session, current.session)) {
      return; // Nothing new (e.g. the unmount flush right after the turn's own save).
    }
    threads[index] = {
      ...current,
      title,
      session,
      events: data.events,
      ...(current.opener || data.opener ? { opener: current.opener ?? data.opener } : {}),
      updatedAt: now,
      rev: (current.rev ?? 0) + 1,
    };
  }

  writeAll(threads);
  scheduleUpload(id, options?.immediate ? 0 : SAVE_DEBOUNCE_MS);
};

const sendDelete = async (id: string) => {
  try {
    const res = await fetch(`${API}/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
    if (res.ok || res.status === 404) forgetDeleted([id]);
  } catch {
    // Kept in DELETED_KEY: the next sync sends it again.
  }
};

export const deleteThread = (id: string) => {
  const pending = saveTimers.get(id);
  if (pending) clearTimeout(pending);
  saveTimers.delete(id);
  uploadAgain.delete(id);
  writeDeleted([...readDeleted().filter((d) => d !== id), id]);
  writeAll(readAll().filter((t) => t.id !== id));
  // After a PUT already on its way, or it would recreate the thread.
  void (inflight.get(id) ?? Promise.resolve()).then(() => sendDelete(id));
};

// ── Sync ──────────────────────────────────────────────────────────────────

let running: Promise<void> | null = null;

const runSync = async () => {
  const listStartedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(API, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
  } catch {
    return;
  }
  if (!res.ok) return;
  const { threads: server } = (await res.json()) as { threads?: ServerSummary[] };
  if (!Array.isArray(server)) return;

  const plan = planThreadSync({ local: readAll(), server, deleted: readDeleted(), listStartedAt, capacity });

  forgetDeleted(plan.forget);
  for (const id of plan.deleteAgain) void sendDelete(id);

  if (plan.drop.length > 0 || plan.touch.length > 0) {
    const drop = new Set(plan.drop);
    const touch = new Map(plan.touch.map((s) => [s.id, s]));
    const seenAt = Date.now();
    const threads = readAll().flatMap((t): AgentThread[] => {
      // Re-checked: a save may have landed since the plan was made.
      if (drop.has(t.id) && !isThreadDirty(t)) return [];
      const s = touch.get(t.id);
      if (!s || isThreadDirty(t) || t.events.length !== s.eventCount) return [t];
      return [{ ...t, title: s.title, updatedAt: s.updatedAt, remote: { rev: t.rev ?? 0, updatedAt: s.updatedAt, eventCount: s.eventCount, seenAt } }];
    });
    writeAll(threads);
  }

  const queue = [...plan.fetch];
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) await pullThread(id);
    })
  );

  await Promise.all(plan.upload.map((id) => uploadThread(id)));
};

/** One sync at a time: a call while one runs shares it. */
export const syncThreads = (): Promise<void> => {
  if (!isBrowser()) return Promise.resolve();
  running ??= runSync()
    .catch(() => {
      // A malformed response: the next sync tries again.
    })
    .finally(() => {
      running = null;
    });
  return running;
};

let syncUsers = 0;
let stopSyncLoop: (() => void) | null = null;

const startSyncLoop = () => {
  const visible = () => document.visibilityState === "visible";
  const onVisibility = () => {
    if (visible()) void syncThreads();
    else flushPendingUploads();
  };
  const onFocus = () => void syncThreads();
  const timer = setInterval(() => {
    if (visible()) void syncThreads();
  }, SYNC_INTERVAL_MS);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onFocus);
  window.addEventListener("pagehide", flushPendingUploads);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("pagehide", flushPendingUploads);
  };
};

/**
 * Keeps the cache in step with the server while mounted: a sync on mount, on
 * window focus, when the tab becomes visible and every 30 s while visible.
 * Shared by every caller (one loop per page however many components use it).
 */
export const useAgentThreadSync = () => {
  useEffect(() => {
    syncUsers += 1;
    if (syncUsers === 1) stopSyncLoop = startSyncLoop();
    void syncThreads();
    return () => {
      syncUsers -= 1;
      if (syncUsers === 0) {
        stopSyncLoop?.();
        stopSyncLoop = null;
      }
    };
  }, []);
};

const subscribe = (onChange: () => void) => {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    version += 1; // Another tab changed the cache.
    onChange();
  };
  window.addEventListener(THREADS_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THREADS_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
};

/** Changes whenever the cached threads change; -1 during server render and hydration. */
export const useThreadsVersion = () =>
  useSyncExternalStore(
    subscribe,
    () => version,
    () => -1
  );

/** The cached threads, newest first, re-read on every change. Empty until hydrated. */
export const useAgentThreads = (): AgentThread[] => {
  const v = useThreadsVersion();
  return useMemo(() => (v < 0 ? [] : listThreads()), [v]);
};
