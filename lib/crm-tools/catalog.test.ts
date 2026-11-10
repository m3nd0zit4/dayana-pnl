import { describe, expect, test } from "bun:test";
import { TOOL_CATALOG, TOOL_NAMES } from "@/lib/crm-tools/catalog";
import { toolDefinition } from "@/lib/crm-tools/registry";

/**
 * The catalog decides what an MCP token can see and call, so its invariants
 * are tested, not trusted.
 */

describe("tool catalog", () => {
  test("every write is marked as needing a human's yes", () => {
    const missing = TOOL_NAMES.filter(
      (n) => TOOL_CATALOG[n].access !== "read" && toolDefinition(n).approval === undefined
    );
    expect(missing).toEqual([]);
  });

  test("reads are never marked", () => {
    const gated = TOOL_NAMES.filter((n) => TOOL_CATALOG[n].access === "read" && toolDefinition(n).approval !== undefined);
    expect(gated).toEqual([]);
  });

  test("the tools that only made sense for the panel assistant are gone", () => {
    expect(TOOL_NAMES).not.toContain("memory" as never);
    expect(TOOL_NAMES).not.toContain("message_owner" as never);
  });

  test("every tool has a definition with a description and a schema", () => {
    for (const name of TOOL_NAMES) {
      const definition = toolDefinition(name);
      expect(definition.description.length).toBeGreaterThan(10);
      expect(typeof definition.inputSchema.safeParse).toBe("function");
    }
  });
});
