import { describe, expect, test } from "bun:test";

import { humanWroteWithin } from "./send-policy";

const now = new Date("2026-11-21T20:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000);
const msg = (over: Partial<{ direction: string; isAutoReply: boolean; source: string | null; clientKey: string | null; sentAt: Date }>) => ({
  direction: "OUTBOUND",
  isAutoReply: false,
  source: null,
  clientKey: null,
  sentAt: ago(5),
  ...over,
});

describe("humanWroteWithin (auditoría 21-nov: Kate, Yanet)", () => {
  test("Dayana escribió hace 5 s: la conversación es suya", () => {
    expect(humanWroteWithin([msg({})], now, 30)).toBe(true);
  });
  test("la IA, un recordatorio, una propuesta aprobada o algo viejo no cuentan", () => {
    expect(humanWroteWithin([msg({ isAutoReply: true })], now, 30)).toBe(false);
    expect(humanWroteWithin([msg({ source: "approval" })], now, 30)).toBe(false);
    expect(humanWroteWithin([msg({ sentAt: ago(31 * 60) })], now, 30)).toBe(false);
    expect(humanWroteWithin([msg({ direction: "INBOUND" })], now, 30)).toBe(false);
  });
});
