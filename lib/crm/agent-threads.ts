import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * The panel assistant's conversations, per staff user, so the phone and the
 * computer show the same list and the same history. The browser keeps a copy
 * in localStorage as a cache; this table is the truth.
 *
 * Saves are append-only by event count: a device that was offline (or an old
 * tab) holding fewer events than the server never overwrites newer turns —
 * the save is refused and the device pulls the server copy instead.
 */

export const MAX_THREADS_PER_STAFF = 40;
/** A thread larger than this is refused (inlined attachments, huge tool tables). */
export const MAX_THREAD_BYTES = 4_000_000;

export type AgentThreadSummary = {
  id: string;
  agent: string;
  title: string;
  opener: unknown;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentThreadFull = AgentThreadSummary & { session: unknown; events: unknown[] };

const SUMMARY = {
  id: true,
  agent: true,
  title: true,
  opener: true,
  eventCount: true,
  createdAt: true,
  updatedAt: true,
} as const;

const toSummary = (row: {
  id: string;
  agent: string;
  title: string;
  opener: Prisma.JsonValue;
  eventCount: number;
  createdAt: Date;
  updatedAt: Date;
}): AgentThreadSummary => ({
  id: row.id,
  agent: row.agent,
  title: row.title,
  opener: row.opener ?? null,
  eventCount: row.eventCount,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const listAgentThreads = async (staffUserId: string): Promise<AgentThreadSummary[]> =>
  (
    await prisma.agentThread.findMany({
      where: { staffUserId },
      orderBy: { updatedAt: "desc" },
      take: MAX_THREADS_PER_STAFF,
      select: SUMMARY,
    })
  ).map(toSummary);

export const getAgentThread = async (staffUserId: string, id: string): Promise<AgentThreadFull | null> => {
  const row = await prisma.agentThread.findFirst({
    where: { id, staffUserId },
    select: { ...SUMMARY, session: true, events: true },
  });
  if (!row) return null;
  return {
    ...toSummary(row),
    session: row.session ?? null,
    events: Array.isArray(row.events) ? row.events : [],
  };
};

export type SaveThreadInput = {
  agent: string;
  title: string;
  opener?: unknown;
  session?: unknown;
  events: unknown[];
};

export type SaveThreadResult =
  | { ok: true; thread: AgentThreadSummary }
  | { ok: false; reason: "stale"; thread: AgentThreadSummary }
  | { ok: false; reason: "too_large" | "not_found" };

/** Pure: may this save replace what the server holds? */
export const acceptsSave = (stored: { eventCount: number } | null, incomingEvents: number) =>
  stored === null || incomingEvents >= stored.eventCount;

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export const saveAgentThread = async (
  staffUserId: string,
  id: string,
  input: SaveThreadInput
): Promise<SaveThreadResult> => {
  if (Buffer.byteLength(JSON.stringify(input.events)) > MAX_THREAD_BYTES) return { ok: false, reason: "too_large" };

  const stored = await prisma.agentThread.findUnique({
    where: { id },
    select: { ...SUMMARY, staffUserId: true },
  });
  // An id that belongs to someone else is never touched (nor revealed).
  if (stored && stored.staffUserId !== staffUserId) return { ok: false, reason: "not_found" };
  if (stored && !acceptsSave(stored, input.events.length)) {
    return { ok: false, reason: "stale", thread: toSummary(stored) };
  }

  const data = {
    agent: input.agent,
    title: input.title.slice(0, 200),
    session: input.session === undefined ? undefined : json(input.session),
    events: json(input.events),
    eventCount: input.events.length,
  };
  const row = stored
    ? await prisma.agentThread.update({
        where: { id },
        // The agent and the opener are fixed at creation.
        data: { title: data.title, events: data.events, eventCount: data.eventCount, ...(data.session ? { session: data.session } : {}) },
        select: SUMMARY,
      })
    : await prisma.agentThread.create({
        data: {
          id,
          staffUserId,
          ...data,
          ...(input.opener ? { opener: json(input.opener) } : {}),
        },
        select: SUMMARY,
      });

  // Keep the newest MAX_THREADS_PER_STAFF.
  const overflow = await prisma.agentThread.findMany({
    where: { staffUserId },
    orderBy: { updatedAt: "desc" },
    skip: MAX_THREADS_PER_STAFF,
    select: { id: true },
  });
  if (overflow.length) await prisma.agentThread.deleteMany({ where: { id: { in: overflow.map((t) => t.id) } } });

  return { ok: true, thread: toSummary(row) };
};

export const deleteAgentThread = async (staffUserId: string, id: string): Promise<boolean> =>
  (await prisma.agentThread.deleteMany({ where: { id, staffUserId } })).count > 0;

// ── Small per-user UI state (StaffUiState) ───────────────────────────────

/** The only keys a client may read or write. */
export const UI_STATE_KEYS = ["contact-search-recents"] as const;
export type UiStateKey = (typeof UI_STATE_KEYS)[number];
export const isUiStateKey = (key: string): key is UiStateKey => (UI_STATE_KEYS as readonly string[]).includes(key);

const UI_STATE_MAX_BYTES = 20_000;

export const getUiState = async (staffUserId: string, key: UiStateKey): Promise<unknown> =>
  (await prisma.staffUiState.findUnique({ where: { staffUserId_key: { staffUserId, key } }, select: { value: true } }))?.value ??
  null;

export const setUiState = async (staffUserId: string, key: UiStateKey, value: unknown): Promise<boolean> => {
  if (Buffer.byteLength(JSON.stringify(value)) > UI_STATE_MAX_BYTES) return false;
  await prisma.staffUiState.upsert({
    where: { staffUserId_key: { staffUserId, key } },
    create: { staffUserId, key, value: json(value) },
    update: { value: json(value) },
  });
  return true;
};
