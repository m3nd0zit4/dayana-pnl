import { describe, expect, test } from "bun:test";

import { summarizeGuards } from "./guard-report";

const at = new Date("2026-11-21T12:00:00Z");
describe("summarizeGuards", () => {
  test("cuenta las correcciones del código (auto) y los motivos de no contestar", () => {
    const r = summarizeGuards(
      [
        { conversationId: "c1", queuedAt: at, status: "REPLIED", reason: null, toolCalls: [{ tool: "dayana_claim", input: { auto: true }, output: { replaced: "Dayana me pidió…" } }, { tool: "book_free_call", input: {}, output: {} }] },
        { conversationId: "c2", queuedAt: at, status: "REPLIED", reason: null, toolCalls: [{ tool: "dayana_claim", input: { auto: true }, output: {} }] },
        { conversationId: "c3", queuedAt: at, status: "SKIPPED", reason: "after_call", toolCalls: null },
        { conversationId: "c4", queuedAt: at, status: "SKIPPED", reason: "no_reply: le responde a Dayana", toolCalls: null },
      ],
      at
    );
    expect(r.runs).toBe(4);
    expect(r.byStatus).toEqual({ REPLIED: 2, SKIPPED: 2 });
    expect(r.guards).toHaveLength(1);
    expect(r.guards[0]).toMatchObject({ name: "dayana_claim", label: "Decía algo de Dayana sin respaldo", count: 2 });
    expect(r.guards[0].examples[0].replaced).toBe("Dayana me pidió…");
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(["after_call", "no_reply"]);
  });
});
