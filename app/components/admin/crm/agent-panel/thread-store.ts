import type { HandleMessageStreamEvent, SessionState } from "eve/client";
import type { AgentId } from "@/agent/lib/catalog";
import { DEFAULT_THREAD_TITLE, deriveTitle, normalizeThreads, type StoredThread } from "@/lib/agent-ui/threads";

export type AgentThread = StoredThread<SessionState, HandleMessageStreamEvent>;

export { DEFAULT_THREAD_TITLE, deriveTitle };

const STORAGE_KEY = "crm-agent-threads";
const MAX_THREADS = 20;

/** Every read goes through `normalizeThreads`, which also migrates threads saved before agents existed (→ "auto"). */
const readAll = (): AgentThread[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeThreads<SessionState, HandleMessageStreamEvent>(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
};

const writeAll = (threads: AgentThread[]) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(threads.slice(0, MAX_THREADS)));
  } catch {
    // Quota exceeded (inlined attachments are big): keep the newest half.
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(threads.slice(0, Math.ceil(MAX_THREADS / 2))));
    } catch {
      // Nothing else to do: the conversation still works, it just won't be in history.
    }
  }
};

export const listThreads = (): AgentThread[] =>
  readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const getThread = (id: string): AgentThread | undefined => readAll().find((t) => t.id === id);

/** Creates the thread on first save, updates it on every save after. The agent is set once: a thread never changes agent. */
export const upsertThread = (
  id: string,
  data: { title?: string; agent: AgentId; session?: SessionState; events: readonly HandleMessageStreamEvent[] }
) => {
  const threads = readAll();
  const index = threads.findIndex((t) => t.id === id);

  if (index === -1) {
    threads.unshift({
      id,
      title: data.title ?? DEFAULT_THREAD_TITLE,
      createdAt: new Date().toISOString(),
      agent: data.agent,
      session: data.session,
      events: data.events,
    });
  } else {
    threads[index] = {
      ...threads[index],
      ...(data.title ? { title: data.title } : {}),
      session: data.session ?? threads[index].session,
      events: data.events,
    };
  }

  writeAll(threads);
};

export const deleteThread = (id: string) => {
  writeAll(readAll().filter((t) => t.id !== id));
};
