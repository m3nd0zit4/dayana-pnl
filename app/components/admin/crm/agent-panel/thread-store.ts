import type { HandleMessageStreamEvent, SessionState } from "eve/client";

export type AgentThread = {
  id: string;
  title: string;
  createdAt: string;
  session?: SessionState;
  events: readonly HandleMessageStreamEvent[];
};

const STORAGE_KEY = "crm-agent-threads";
const MAX_THREADS = 20;

const readAll = (): AgentThread[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgentThread[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeAll = (threads: AgentThread[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(threads.slice(0, MAX_THREADS)));
};

export const listThreads = (): AgentThread[] =>
  readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const getThread = (id: string): AgentThread | undefined =>
  readAll().find((t) => t.id === id);

/** Creates the thread on first save, updates it on every save after. */
export const upsertThread = (
  id: string,
  data: { title?: string; session?: SessionState; events: readonly HandleMessageStreamEvent[] }
) => {
  const threads = readAll();
  const index = threads.findIndex((t) => t.id === id);

  if (index === -1) {
    threads.unshift({
      id,
      title: data.title ?? "Nueva conversación",
      createdAt: new Date().toISOString(),
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

export const deriveTitle = (firstUserText: string) =>
  firstUserText.trim().slice(0, 60) || "Nueva conversación";
