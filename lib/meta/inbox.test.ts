import { describe, expect, test } from "bun:test";

import type { NormalizedEvent } from "./inbound";
import { backoffMs, dedupeKeyFor, inboxKindOf, reviveEvent } from "./inbox";

const msg = (over: Partial<Extract<NormalizedEvent, { kind: "message" }>> = {}): NormalizedEvent => ({
  kind: "message",
  channel: "WHATSAPP",
  metaAccountId: "pn1",
  threadId: "573001112233",
  externalMessageId: "wamid.A",
  isEcho: false,
  body: "Hola",
  attachments: [],
  replyToExternalId: null,
  sentAt: new Date("2026-09-24T10:00:00Z"),
  participantName: "Ana",
  ...over,
});

describe("cola de entrada", () => {
  test("la misma cosa no entra dos veces; un acuse por estado", () => {
    expect(dedupeKeyFor(msg())).toBe("msg:wamid.A");
    const st = { kind: "status", channel: "WHATSAPP", externalMessageId: "wamid.A", status: "READ", at: new Date() } as unknown as NormalizedEvent;
    expect(dedupeKeyFor(st)).toBe("st:wamid.A:READ");
    const ct = { kind: "contact", phone: "573", name: "Ana" } as unknown as NormalizedEvent;
    expect(dedupeKeyFor(ct)).toBe(dedupeKeyFor({ ...ct } as NormalizedEvent));
    expect(dedupeKeyFor(ct)).toMatch(/^ct:/);
  });

  test("el historial va aparte", () => {
    expect(inboxKindOf(msg())).toBe("message");
    expect(inboxKindOf(msg({ isHistory: true }))).toBe("history");
  });

  test("espera creciente con techo de 1 hora", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(12)).toBe(3_600_000);
  });

  test("las fechas sobreviven al viaje por JSON", () => {
    const back = reviveEvent(JSON.parse(JSON.stringify(msg())));
    expect(back.kind === "message" && back.sentAt instanceof Date).toBe(true);
    expect(back.kind === "message" && back.sentAt.toISOString()).toBe("2026-09-24T10:00:00.000Z");
  });
});
