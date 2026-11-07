import { describe, expect, test } from "bun:test";

import { describeAgentError, lastFailureMessage } from "./errors";
import { capList, collectNames, dedupeRefs, extractRefs } from "./refs";

describe("refs", () => {
  const ref = (id: string, label?: string) => ({ type: "contact", id, href: `/admin/contacts/${id}`, ...(label ? { label } : {}) });

  test("extractRefs finds *Ref fields with sibling labels", () => {
    const refs = extractRefs({ contacts: [{ contactRef: ref("a"), contactName: "Ana" }, { ref: ref("b"), displayName: "Bea" }] });
    expect(refs.map((r) => r.label)).toEqual(["Ana", "Bea"]);
  });

  test("dedupe keeps one per href and prefers a labelled one", () => {
    expect(dedupeRefs([ref("a"), ref("a", "Ana"), ref("b")])).toEqual([ref("a", "Ana"), ref("b")]);
  });

  test("capList", () => {
    expect(capList([1, 2, 3, 4, 5, 6, 7, 8], 6)).toEqual({ shown: [1, 2, 3, 4, 5, 6], hidden: 2 });
    expect(capList([1], 6)).toEqual({ shown: [1], hidden: 0 });
  });

  test("collectNames maps ids and slugs to labels", () => {
    const names = collectNames([
      { contacts: [{ id: "c1", firstName: "Ana", lastName: "Pérez" }] },
      { workshop: { id: "w1", slug: "sanacion", title: "Sanación con el dinero" } },
      { enrollmentRef: ref("e1"), enrollmentName: "Terapia de Ana" },
    ]);
    expect(names.c1).toBe("Ana Pérez");
    expect(names.sanacion).toBe("Sanación con el dinero");
    expect(names.w1).toBe("Sanación con el dinero");
    expect(names.e1).toBe("Terapia de Ana");
  });
});

describe("errors", () => {
  test("last failure message, unless a later turn completed", () => {
    expect(lastFailureMessage([{ type: "turn.failed", data: { message: "boom" } }])).toBe("boom");
    expect(lastFailureMessage([{ type: "turn.failed", data: { message: "boom" } }, { type: "turn.completed" }])).toBeNull();
    expect(lastFailureMessage([])).toBeNull();
  });

  test("known causes in Spanish, raw otherwise", () => {
    expect(describeAgentError("429 RESOURCE_EXHAUSTED")).toContain("límite");
    expect(describeAgentError("Failed to fetch")).toContain("conexión");
    expect(describeAgentError("Algo raro pasó")).toBe("Algo raro pasó");
    expect(describeAgentError("")).toBeNull();
    expect(describeAgentError(undefined)).toBeNull();
    expect(describeAgentError("x".repeat(400))!.length).toBeLessThanOrEqual(180);
  });
});
