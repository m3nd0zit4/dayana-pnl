import { describe, expect, test } from "bun:test";

import { deliveryOf } from "./workspace";

const msg = (id: string, status: string, at: string, extra: Partial<{ isAutoReply: boolean; failedReason: string }> = {}) => ({
  id,
  direction: "OUTBOUND",
  status,
  sentAt: new Date(at),
  isAutoReply: extra.isAutoReply ?? true,
  failedReason: extra.failedReason ?? null,
});

describe("deliveryOf: la línea de estado dice lo mismo que el mensaje", () => {
  test("aprobado pero WhatsApp no lo entregó (caso Emily)", () => {
    const d = deliveryOf(
      { status: "APPROVED", startedAt: null, finishedAt: null, proposal: { sentMessageId: "m1" } },
      [msg("m1", "FAILED", "2026-09-24T17:02:18Z", { failedReason: "Message undeliverable" })]
    );
    expect(d).toEqual({ status: "FAILED", error: "Message undeliverable" });
  });
  test("aprobado y leído", () => {
    expect(
      deliveryOf({ status: "APPROVED", startedAt: null, finishedAt: null, proposal: { sentMessageId: "m1" } }, [
        msg("m1", "READ", "2026-09-24T17:02:18Z"),
      ])
    ).toEqual({ status: "READ", error: null });
  });
  test("la IA respondió: toma el mensaje que mandó en esa vuelta; un fallo manda", () => {
    const run = {
      status: "REPLIED",
      startedAt: new Date("2026-09-24T17:00:00Z"),
      finishedAt: new Date("2026-09-24T17:00:05Z"),
    };
    expect(
      deliveryOf(run, [
        msg("a", "DELIVERED", "2026-09-24T17:00:04Z"),
        msg("b", "FAILED", "2026-09-24T17:00:06Z"),
        msg("old", "READ", "2026-09-24T16:00:00Z"),
      ])
    ).toEqual({ status: "FAILED", error: null });
  });
  test("sin mensaje ligado: nada que afirmar", () => {
    expect(deliveryOf({ status: "APPROVED", startedAt: null, finishedAt: null, proposal: {} }, [])).toBeNull();
  });
});
