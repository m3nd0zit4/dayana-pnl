import { describe, expect, test } from "bun:test";

import {
  DEFAULT_THREAD_TITLE,
  deriveTitle,
  isThreadDirty,
  normalizeThreads,
  openerContext,
  planThreadSync,
  splitSessions,
  threadFromServer,
} from "./threads";

describe("normalizeThreads", () => {
  test("old threads without an agent become «auto»; valid agents are kept", () => {
    const threads = normalizeThreads([
      { id: "a", title: "Ventas de octubre", createdAt: "2026-10-01T00:00:00.000Z", events: [{ type: "x" }] },
      { id: "b", title: "Chats", createdAt: "2026-10-02T00:00:00.000Z", agent: "whatsapp", events: [] },
      { id: "c", title: "Raro", createdAt: "2026-10-03T00:00:00.000Z", agent: "marketing", events: [] },
    ]);
    expect(threads.map((t) => t.agent)).toEqual(["auto", "whatsapp", "auto"]);
    expect(threads[0].events).toEqual([{ type: "x" }]);
  });

  test("drops garbage and duplicates, fills defaults", () => {
    const threads = normalizeThreads([null, 3, { title: "sin id" }, { id: "a" }, { id: "a", title: "dup" }, { id: "b", events: "no" }]);
    expect(threads.map((t) => t.id)).toEqual(["a", "b"]);
    expect(threads[0].title).toBe(DEFAULT_THREAD_TITLE);
    expect(threads[1].events).toEqual([]);
    expect(typeof threads[0].createdAt).toBe("string");
  });

  test("keeps a valid opener; old threads and broken openers have none", () => {
    const opener = { key: "k1", title: "Pagos pendientes", message: "Hay 3 pagos sin confirmar. ¿Los reviso?", createdAt: "2026-11-07T13:00:00.000Z" };
    const threads = normalizeThreads([
      { id: "a", title: "Pagos pendientes", agent: "auto", events: [], opener },
      { id: "b", title: "Vieja", events: [] },
      { id: "c", opener: { key: "k2" } },
      { id: "d", opener: { key: "", message: "hola" } },
      { id: "e", opener: "texto" },
      { id: "f", opener: { key: "k3", message: "Hola" } },
    ]);
    expect(threads[0].opener).toEqual(opener);
    expect(threads.slice(1, 5).map((t) => t.opener)).toEqual([undefined, undefined, undefined, undefined]);
    expect("opener" in threads[1]).toBe(false);
    expect(threads[5].opener).toEqual({ key: "k3", title: DEFAULT_THREAD_TITLE, message: "Hola", createdAt: new Date(0).toISOString() });
  });

  test("non-array storage reads as empty", () => {
    expect(normalizeThreads({ id: "a" })).toEqual([]);
    expect(normalizeThreads(undefined)).toEqual([]);
  });
});

describe("openerContext", () => {
  test("quotes what the assistant wrote first", () => {
    expect(openerContext({ message: "  ¿Reviso los 3 pagos?  " })).toBe(
      "Contexto: antes de esta conversación tú (el asistente) le escribiste a la dueña: «¿Reviso los 3 pagos?». Ella responde a eso."
    );
  });
});

describe("deriveTitle", () => {
  test("first 60 chars, whitespace collapsed", () => {
    expect(deriveTitle("  ¿Cuánto   vendimos\neste mes?  ")).toBe("¿Cuánto vendimos este mes?");
    expect(deriveTitle("x".repeat(80))).toHaveLength(60);
    expect(deriveTitle("   ")).toBe(DEFAULT_THREAD_TITLE);
  });
});

describe("splitSessions", () => {
  test("a retried thread splits at each new session", () => {
    const events = [
      { type: "session.started", n: 1 },
      { type: "turn.started", n: 2 },
      { type: "session.failed", n: 3 },
      { type: "session.started", n: 4 },
      { type: "turn.started", n: 5 },
    ];
    expect(splitSessions(events).map((s) => s.map((e) => e.n))).toEqual([[1, 2, 3], [4, 5]]);
  });

  test("a log that doesn't start with session.started stays in one piece", () => {
    expect(splitSessions([{ type: "turn.started" }, { type: "turn.completed" }])).toHaveLength(1);
    expect(splitSessions([])).toEqual([]);
  });
});

describe("sync fields", () => {
  test("threads cached before sync have no sync fields; valid ones are kept, broken ones dropped", () => {
    const remote = { rev: 2, updatedAt: "2026-11-08T10:00:00.000Z", eventCount: 4, seenAt: 1000 };
    const [old, synced, broken] = normalizeThreads([
      { id: "a", events: [] },
      { id: "b", events: [], updatedAt: "2026-11-08T10:00:00.000Z", rev: 2, remote, rejectedRev: 1 },
      { id: "c", events: [], rev: -1, remote: { rev: 1 }, rejectedRev: "x" },
    ]);
    expect(["updatedAt", "rev", "remote", "rejectedRev"].some((k) => k in old)).toBe(false);
    expect(isThreadDirty(old)).toBe(true);
    expect(synced).toMatchObject({ updatedAt: "2026-11-08T10:00:00.000Z", rev: 2, remote, rejectedRev: 1 });
    expect(isThreadDirty(synced)).toBe(false);
    expect(["rev", "remote", "rejectedRev"].some((k) => k in broken)).toBe(false);
  });

  test("threadFromServer: in sync, rev continues the local one, opener and agent normalized", () => {
    const t = threadFromServer(
      {
        id: "s1",
        agent: "whatsapp",
        title: "Chats",
        opener: { key: "k", message: "Hola", title: "T", createdAt: "2026-11-08T09:00:00.000Z" },
        eventCount: 2,
        createdAt: "2026-11-08T09:00:00.000Z",
        updatedAt: "2026-11-08T10:00:00.000Z",
        session: { sessionId: "x" },
        events: [{ type: "a" }, { type: "b" }],
      },
      { rev: 3 },
      5000
    );
    expect(t).toMatchObject({ id: "s1", agent: "whatsapp", rev: 4, updatedAt: "2026-11-08T10:00:00.000Z", session: { sessionId: "x" } });
    expect(t.remote).toEqual({ rev: 4, updatedAt: "2026-11-08T10:00:00.000Z", eventCount: 2, seenAt: 5000 });
    expect(t.opener?.key).toBe("k");
    expect(isThreadDirty(t)).toBe(false);
    expect(threadFromServer({ id: "s2", agent: "nope", title: "", opener: null, eventCount: 0, createdAt: "c", updatedAt: "u" }, undefined, 1)).toMatchObject({
      agent: "auto",
      title: DEFAULT_THREAD_TITLE,
      events: [],
      rev: 1,
    });
  });
});

describe("planThreadSync", () => {
  const ev = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));
  const synced = (id: string, n: number, extra: Record<string, unknown> = {}) => ({
    id,
    title: id,
    events: ev(n),
    rev: 1,
    remote: { rev: 1, updatedAt: `u-${id}`, eventCount: n, seenAt: 100 },
    ...extra,
  });
  const summary = (id: string, n: number, updatedAt = `u-${id}`, title = id) => ({ id, title, eventCount: n, updatedAt });
  const base = { deleted: [] as string[], listStartedAt: 200, capacity: 30 };

  test("nothing to do when both sides match", () => {
    const plan = planThreadSync({ ...base, local: [synced("a", 3)], server: [summary("a", 3)] });
    expect(plan).toEqual({ fetch: [], upload: [], drop: [], touch: [], deleteAgain: [], forget: [] });
  });

  test("server-only threads and threads with more events on the server are pulled", () => {
    const plan = planThreadSync({ ...base, local: [synced("a", 3)], server: [summary("new", 2), summary("a", 5)] });
    expect(plan.fetch).toEqual(["new", "a"]);
  });

  test("the server holding more wins even over unsent local changes", () => {
    const dirty = synced("a", 3, { rev: 2 });
    expect(planThreadSync({ ...base, local: [dirty], server: [summary("a", 4)] })).toMatchObject({ fetch: ["a"], upload: [] });
  });

  test("local changes the server lacks are uploaded; local-only history is uploaded once", () => {
    const plan = planThreadSync({
      ...base,
      local: [synced("more", 5), synced("dirty", 3, { rev: 2 }), { id: "legacy", title: "x", events: ev(2) }],
      server: [summary("more", 3), summary("dirty", 3)],
    });
    expect(plan.upload).toEqual(["more", "dirty", "legacy"]);
  });

  test("a refused revision isn't retried until it changes", () => {
    const plan = planThreadSync({
      ...base,
      local: [{ id: "big", title: "x", events: ev(2), rev: 1, rejectedRev: 1 }, { id: "big2", title: "y", events: ev(2), rev: 2, rejectedRev: 1 }],
      server: [],
    });
    expect(plan.upload).toEqual(["big2"]);
  });

  test("uploaded threads the server no longer has were deleted elsewhere, unless uploaded during the list request or continued here", () => {
    const plan = planThreadSync({
      ...base,
      local: [
        synced("gone", 2),
        synced("fresh", 1, { remote: { rev: 1, updatedAt: "u", eventCount: 1, seenAt: 250 } }),
        synced("continued", 3, { rev: 2 }),
      ],
      server: [],
    });
    expect(plan.drop).toEqual(["gone"]);
    expect(plan.upload).toEqual(["continued"]);
  });

  test("same events, new title or updatedAt → touch without pulling", () => {
    const plan = planThreadSync({ ...base, local: [synced("a", 3)], server: [summary("a", 3, "u-later", "Nuevo título")] });
    expect(plan.touch).toEqual([{ id: "a", title: "Nuevo título", updatedAt: "u-later", eventCount: 3 }]);
    expect(plan.fetch).toEqual([]);
  });

  test("deleted here: the DELETE is sent again while the server has it, forgotten once it doesn't", () => {
    const plan = planThreadSync({ ...base, deleted: ["x", "y"], local: [], server: [summary("x", 2)] });
    expect(plan.deleteAgain).toEqual(["x"]);
    expect(plan.fetch).toEqual([]);
    expect(plan.forget).toEqual(["y"]);
  });

  test("capacity: server threads beyond it aren't downloaded, but cached ones beyond it are kept", () => {
    const plan = planThreadSync({
      ...base,
      capacity: 1,
      local: [synced("c", 1)],
      server: [summary("a", 1), summary("b", 1), summary("c", 1)],
    });
    expect(plan.fetch).toEqual(["a"]);
    expect(plan.drop).toEqual([]);
  });
});
