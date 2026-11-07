import { describe, expect, test } from "bun:test";
import { AGENT_ORDER, SPECIALIST_IDS, TOOL_CATALOG, toolsForAgent, type ToolName } from "@/agent/lib/catalog";
import { toolDefinition } from "@/agent/lib/registry";

/**
 * The catalog is what decides who can do what — in the panel agents and in
 * the MCP server — so its invariants are tested, not trusted.
 */

const names = Object.keys(TOOL_CATALOG) as ToolName[];

/** Writes that deliberately skip the approval card. */
const NO_APPROVAL_WRITES = new Set<ToolName>([
  // The agent's own notes; audited, and asking every time would kill the habit.
  "memory",
  // A note to Dayana herself (bell + push), never to a client; an approval card
  // would land on the very person it is addressed to.
  "message_owner",
]);

describe("tool catalog", () => {
  test("every write pauses for approval in the panel", () => {
    const missing = names.filter(
      (n) => TOOL_CATALOG[n].access !== "read" && !NO_APPROVAL_WRITES.has(n) && toolDefinition(n).approval === undefined
    );
    expect(missing).toEqual([]);
  });

  test("reads never ask for approval", () => {
    const gated = names.filter((n) => TOOL_CATALOG[n].access === "read" && toolDefinition(n).approval !== undefined);
    expect(gated).toEqual([]);
  });

  test("every agent has tools and memory", () => {
    for (const agent of AGENT_ORDER) {
      expect(toolsForAgent(agent).length).toBeGreaterThan(2);
      expect(toolsForAgent(agent)).toContain("memory");
    }
  });

  test("every tool belongs to at least one specialist (so delegation can reach it)", () => {
    const orphan = names.filter((n) => !SPECIALIST_IDS.some((s) => (TOOL_CATALOG[n].agents as string[]).includes(s)));
    expect(orphan).toEqual([]);
  });

  test("specialist tool sets stay small enough for a small model", () => {
    for (const agent of AGENT_ORDER) expect(toolsForAgent(agent).length).toBeLessThanOrEqual(30);
  });
});
