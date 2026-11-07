import { describe, expect, test } from "bun:test";

import { DEFAULT_THREAD_TITLE, deriveTitle, normalizeThreads, openerContext, splitSessions } from "./threads";

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
