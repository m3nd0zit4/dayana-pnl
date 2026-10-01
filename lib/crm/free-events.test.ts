import { describe, expect, test } from "bun:test";

import {
  FREE_EVENT_STATUS_LABEL,
  isFreeEventMaterialDownloadable,
  isFreeEventOpen,
  isFreeEventUpcoming,
} from "./free-events";

const now = new Date("2026-09-23T12:00:00Z");

describe("etiquetas de estado", () => {
  test("los cuatro estados tienen nombre en español", () => {
    expect(FREE_EVENT_STATUS_LABEL.DRAFT).toBe("Borrador");
    expect(FREE_EVENT_STATUS_LABEL.OPEN).toBe("Publicado");
    expect(FREE_EVENT_STATUS_LABEL.CLOSED).toBe("Inscripciones cerradas");
    expect(FREE_EVENT_STATUS_LABEL.COMPLETED).toBe("Realizado");
  });
});

describe("qué mensajes tienen sentido para un evento", () => {
  const open = { status: "OPEN" as const, isActive: true, endedAt: null as Date | null };

  test("publicado o con inscripciones cerradas, sin terminar: le toca recordatorio", () => {
    expect(isFreeEventUpcoming(open)).toBe(true);
    // Publicar el siguiente cierra este, pero sus inscritas siguen esperando.
    expect(isFreeEventUpcoming({ ...open, status: "CLOSED", isActive: false })).toBe(true);
    expect(isFreeEventUpcoming({ ...open, endedAt: now })).toBe(false);
    expect(isFreeEventUpcoming({ status: "DRAFT", isActive: false, endedAt: null })).toBe(false);
    expect(isFreeEventUpcoming({ status: "COMPLETED", isActive: false, endedAt: now })).toBe(false);
  });

  test("solo se invita al publicado y sin cerrar", () => {
    expect(isFreeEventOpen(open)).toBe(true);
    expect(isFreeEventOpen({ ...open, status: "CLOSED", isActive: false })).toBe(false);
    expect(isFreeEventOpen({ ...open, endedAt: now })).toBe(false);
  });

  test("el material solo se descarga mientras la web lo sirve", () => {
    const row = {
      ...open,
      startsAt: new Date("2026-10-01T00:00:00Z") as Date | null,
      materialUrl: "https://blob.example/material.pdf" as string | null,
    };
    expect(isFreeEventMaterialDownloadable(row)).toBe(true);
    // Con inscripciones cerradas su material sigue saliendo (?evento=<id>).
    expect(isFreeEventMaterialDownloadable({ ...row, status: "CLOSED", isActive: false })).toBe(true);
    expect(isFreeEventMaterialDownloadable({ ...row, endedAt: now })).toBe(false);
    expect(isFreeEventMaterialDownloadable({ ...row, status: "DRAFT", isActive: false })).toBe(false);
    expect(isFreeEventMaterialDownloadable({ ...row, materialUrl: null })).toBe(false);
    expect(isFreeEventMaterialDownloadable({ ...row, startsAt: null })).toBe(false);
  });
});
