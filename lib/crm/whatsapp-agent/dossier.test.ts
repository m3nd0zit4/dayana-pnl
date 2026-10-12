import { describe, expect, test } from "bun:test";

import { chunkText, dossierText, isDossierStale, trimSameMinuteTail, type Dossier } from "./dossier";

const at = (min: number) => new Date(Date.parse("2026-05-02T14:00:00Z") + min * 60_000);

describe("trimSameMinuteTail", () => {
  test("un tramo lleno no corta a mitad de un minuto", () => {
    const lines = [0, 1, 2, 2].map((m) => ({ sentAt: at(m) }));
    expect(trimSameMinuteTail(lines, 4).map((l) => l.sentAt.getTime())).toEqual([at(0), at(1)].map((d) => d.getTime()));
  });

  test("un tramo incompleto o todo del mismo minuto se deja igual", () => {
    expect(trimSameMinuteTail([{ sentAt: at(1) }, { sentAt: at(1) }], 4)).toHaveLength(2);
    expect(trimSameMinuteTail([0, 0, 0].map((m) => ({ sentAt: at(m) })), 3)).toHaveLength(3);
  });
});

describe("chunkText", () => {
  test("marca quién habla, los masivos aparte y tapa números", () => {
    const text = chunkText([
      { direction: "OUTBOUND", body: "Te invito a la masterclass", sentAt: at(0), isAutoReply: false, source: "bulk:abc", clientKey: null, externalMessageId: null, attachments: [] },
      { direction: "INBOUND", body: "Hola, mi número es 3001234567", sentAt: at(1), isAutoReply: false, source: null, clientKey: null, externalMessageId: null, attachments: [] },
      { direction: "OUTBOUND", body: "Hola, te bendigo", sentAt: at(2), isAutoReply: true, source: null, clientKey: null, externalMessageId: null, attachments: [] },
    ]);
    expect(text).toContain("DAYANA (envío masivo): Te invito");
    expect(text).toContain("PERSONA: Hola, mi número es [número]");
    expect(text).toContain("ASISTENTE: Hola, te bendigo");
  });
});

describe("dossierText", () => {
  const dossier = (facts: object, summary = "- Busca sanar la relación con su mamá") =>
    ({ summary, facts, segment: null, coveredThroughAt: at(0) }) as unknown as Dossier;

  test("dice lo que ya se hizo para no repetirlo, y lo que la mueve es interno", () => {
    const text = dossierText(
      dossier({ country: "México", buyButtons: [{ key: "ansiedad", note: "no duerme" }], asked: { country: true }, invitedToCall: true })
    )!;
    expect(text).toContain("Escribe desde: México");
    expect(text).toContain("no se lo nombres");
    expect(text).toContain("ya dijo de dónde escribe");
    expect(text).toContain("ya se la invitó a la llamada gratis");
  });

  test("sin ficha, nada", () => {
    expect(dossierText(null)).toBeNull();
  });
});

describe("isDossierStale", () => {
  test("vieja si hay mensajes después de lo leído", () => {
    const d = { coveredThroughAt: at(0) } as unknown as Dossier;
    expect(isDossierStale(d, at(5))).toBe(true);
    expect(isDossierStale(d, at(0))).toBe(false);
    expect(isDossierStale(null, at(0))).toBe(true);
  });
});
