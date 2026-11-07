/**
 * The panel's saved conversations, as stored in localStorage. Pure: reading,
 * migrating and splitting are tested in threads.test.ts; the storage I/O
 * itself lives in the panel's thread-store.ts.
 */
import { isAgentId, type AgentId } from "@/agent/lib/catalog";

export const DEFAULT_THREAD_TITLE = "Nueva conversación";

export type StoredThread<TSession = unknown, TEvent = unknown> = {
  id: string;
  title: string;
  createdAt: string;
  /** Pinned at the thread's first turn: the server keeps a session on one agent. */
  agent: AgentId;
  session?: TSession;
  events: readonly TEvent[];
};

/**
 * Accepts whatever was in localStorage — threads saved before agents existed
 * (no `agent`: they ran on the router, so they become "auto"), half-written
 * entries, garbage — and returns only well-formed threads.
 */
export const normalizeThreads = <TSession = unknown, TEvent = unknown>(
  raw: unknown
): StoredThread<TSession, TEvent>[] => {
  if (!Array.isArray(raw)) return [];
  const out: StoredThread<TSession, TEvent>[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    if (typeof t.id !== "string" || !t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({
      id: t.id,
      title: typeof t.title === "string" && t.title.trim() ? t.title : DEFAULT_THREAD_TITLE,
      createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date(0).toISOString(),
      agent: isAgentId(t.agent) ? t.agent : "auto",
      session: (t.session ?? undefined) as TSession | undefined,
      events: Array.isArray(t.events) ? (t.events as TEvent[]) : [],
    });
  }
  return out;
};

export const deriveTitle = (firstUserText: string) =>
  firstUserText.trim().replace(/\s+/g, " ").slice(0, 60) || DEFAULT_THREAD_TITLE;

/**
 * A thread's event log can hold several backend sessions back to back (a
 * failed turn kills its session and the retry opens a new one). eve numbers
 * turns from zero in each session and keys messages by turn id, so reducing
 * the whole log at once merges the new session's first reply into the old
 * failed bubble. Split at every `session.started` and reduce each part alone.
 */
export const splitSessions = <TEvent extends { type: string }>(events: readonly TEvent[]): TEvent[][] => {
  const segments: TEvent[][] = [];
  let current: TEvent[] = [];
  for (const event of events) {
    if (event.type === "session.started" && current.length > 0) {
      segments.push(current);
      current = [];
    }
    current.push(event);
  }
  if (current.length > 0) segments.push(current);
  return segments;
};
