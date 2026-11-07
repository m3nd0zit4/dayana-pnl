/**
 * The panel's saved conversations, as stored in localStorage. Pure: reading,
 * migrating and splitting are tested in threads.test.ts; the storage I/O
 * itself lives in the panel's thread-store.ts.
 */
import { isAgentId, type AgentId } from "@/agent/lib/catalog";

export const DEFAULT_THREAD_TITLE = "Nueva conversación";

/**
 * The message the assistant wrote first, when it started the conversation
 * (`/admin?agentMessage=<key>`). Shown as the thread's first bubble and sent
 * back to the agent on every turn, since it's not in eve's session history.
 */
export type ThreadOpener = { key: string; title: string; message: string; createdAt: string };

export type StoredThread<TSession = unknown, TEvent = unknown> = {
  id: string;
  title: string;
  createdAt: string;
  /** Pinned at the thread's first turn: the server keeps a session on one agent. */
  agent: AgentId;
  session?: TSession;
  events: readonly TEvent[];
  opener?: ThreadOpener;
};

/** A well-formed opener or nothing: threads saved before openers existed have none. */
export const normalizeOpener = (raw: unknown): ThreadOpener | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.key !== "string" || !o.key || typeof o.message !== "string" || !o.message.trim()) return undefined;
  return {
    key: o.key,
    title: typeof o.title === "string" && o.title.trim() ? o.title : DEFAULT_THREAD_TITLE,
    message: o.message,
    createdAt: typeof o.createdAt === "string" ? o.createdAt : new Date(0).toISOString(),
  };
};

/**
 * One-turn context for every message in an opener thread: eve never saw the
 * assistant's first message (it was written outside the session), so without
 * this the agent wouldn't know what she is answering.
 */
export const openerContext = (opener: Pick<ThreadOpener, "message">): string =>
  `Contexto: antes de esta conversación tú (el asistente) le escribiste a la dueña: «${opener.message.trim()}». Ella responde a eso.`;

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
    const opener = normalizeOpener(t.opener);
    out.push({
      id: t.id,
      title: typeof t.title === "string" && t.title.trim() ? t.title : DEFAULT_THREAD_TITLE,
      createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date(0).toISOString(),
      agent: isAgentId(t.agent) ? t.agent : "auto",
      session: (t.session ?? undefined) as TSession | undefined,
      events: Array.isArray(t.events) ? (t.events as TEvent[]) : [],
      ...(opener ? { opener } : {}),
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
