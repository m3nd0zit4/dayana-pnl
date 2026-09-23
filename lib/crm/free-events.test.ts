import { describe, expect, test } from "bun:test";

import { freeEventStatus } from "./free-events";

const now = new Date("2026-09-23T12:00:00Z");
const base = {
  slug: "gratuito",
  isActive: false,
  startsAt: null as Date | null,
  endedAt: null as Date | null,
  archivedAt: null as Date | null,
};

describe("freeEventStatus", () => {
  test("sin publicar y sin fecha: en preparación", () => {
    expect(freeEventStatus(base, now)).toBe("draft");
  });

  test("publicado con fecha futura", () => {
    expect(
      freeEventStatus(
        { ...base, isActive: true, startsAt: new Date("2026-10-01T00:00:00Z") },
        now
      )
    ).toBe("published");
  });

  test("fecha pasada sin cerrar: ya se realizó", () => {
    expect(
      freeEventStatus(
        { ...base, startsAt: new Date("2026-08-16T14:30:00Z") },
        now
      )
    ).toBe("held");
  });

  test("cerrado a mano: realizado", () => {
    expect(freeEventStatus({ ...base, endedAt: now }, now)).toBe("held");
  });

  test("otra edición (slug distinto): archivada", () => {
    expect(freeEventStatus({ ...base, slug: "gratuito-abc" }, now)).toBe(
      "archived"
    );
  });
});
