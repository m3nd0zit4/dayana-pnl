import { describe, expect, test } from "bun:test";

import {
  freeEventStatus,
  isFreeEventMaterialDownloadable,
  isFreeEventOpen,
  isFreeEventUpcoming,
} from "./free-events";

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

describe("qué mensajes tienen sentido para un evento", () => {
  const live = { isCurrent: true, isActive: true, endedAt: null as Date | null };

  test("el actual sin cerrar admite recordatorio, aunque esté despublicado", () => {
    const unpublished = { ...live, isActive: false };
    expect(isFreeEventUpcoming(live)).toBe(true);
    expect(isFreeEventUpcoming(unpublished)).toBe(true);
    expect(isFreeEventUpcoming({ ...live, endedAt: now })).toBe(false);
    expect(isFreeEventUpcoming({ ...live, isCurrent: false })).toBe(false);
  });

  test("solo se invita al que está publicado y sin cerrar", () => {
    expect(isFreeEventOpen(live)).toBe(true);
    expect(isFreeEventOpen({ ...live, isActive: false })).toBe(false);
    expect(isFreeEventOpen({ ...live, endedAt: now })).toBe(false);
  });

  test("el material solo se descarga mientras la web lo sirve", () => {
    const row = {
      ...base,
      isActive: true,
      startsAt: new Date("2026-10-01T00:00:00Z"),
      materialUrl: "https://blob.example/material.pdf" as string | null,
    };
    expect(isFreeEventMaterialDownloadable(row)).toBe(true);
    expect(isFreeEventMaterialDownloadable({ ...row, endedAt: now })).toBe(false);
    expect(isFreeEventMaterialDownloadable({ ...row, slug: "gratuito-abc" })).toBe(false);
    expect(isFreeEventMaterialDownloadable({ ...row, isActive: false })).toBe(false);
    expect(isFreeEventMaterialDownloadable({ ...row, materialUrl: null })).toBe(false);
  });
});
