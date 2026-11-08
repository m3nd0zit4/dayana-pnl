import { describe, expect, test } from "bun:test";

import { MAX_RECENTS, mergeContactRecents, normalizeContactRecents, type ContactRecentHit } from "./contact-search-recents";

const hit = (id: string, usedAt?: string): ContactRecentHit => ({
  id,
  firstName: id.toUpperCase(),
  lastName: null,
  phoneE164: "+570000000",
  ...(usedAt ? { usedAt } : {}),
});

describe("mergeContactRecents", () => {
  test("phone and computer lists become one, newest first, by id", () => {
    const phone = [hit("a", "2026-11-08T10:00:00.000Z"), hit("b", "2026-11-07T10:00:00.000Z")];
    const computer = [hit("c", "2026-11-08T09:00:00.000Z"), hit("a", "2026-11-01T10:00:00.000Z")];
    expect(mergeContactRecents(phone, computer).map((c) => [c.id, c.usedAt])).toEqual([
      ["a", "2026-11-08T10:00:00.000Z"],
      ["c", "2026-11-08T09:00:00.000Z"],
      ["b", "2026-11-07T10:00:00.000Z"],
    ]);
  });

  test("the most recent use of a contact wins, with its name", () => {
    const merged = mergeContactRecents([{ ...hit("a", "2026-11-01T00:00:00.000Z"), firstName: "Vieja" }], [
      { ...hit("a", "2026-11-08T00:00:00.000Z"), firstName: "Nueva" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].firstName).toBe("Nueva");
  });

  test("entries from before sync (no date) go after dated ones, in their order; capped", () => {
    const old = Array.from({ length: 10 }, (_, i) => hit(`old${i}`));
    const merged = mergeContactRecents(old, [hit("new", "2026-11-08T00:00:00.000Z")]);
    expect(merged).toHaveLength(MAX_RECENTS);
    expect(merged.map((c) => c.id).slice(0, 3)).toEqual(["new", "old0", "old1"]);
  });
});

describe("normalizeContactRecents", () => {
  test("keeps well-formed entries only", () => {
    expect(normalizeContactRecents([hit("a"), { id: 1 }, null, "x", { id: "b", firstName: "B" }])).toEqual([hit("a")]);
    expect(normalizeContactRecents({ value: [] })).toEqual([]);
  });
});
