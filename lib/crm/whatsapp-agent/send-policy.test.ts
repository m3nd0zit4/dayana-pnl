import { describe, expect, test } from "bun:test";

import { decideProactive, humanWroteWithin } from "./send-policy";

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

describe("decideProactive: la puerta única (fase 1, 21-nov)", () => {
  const BOG = "America/Bogota";
  const noon = new Date("2026-11-21T17:00:00Z"); // 12:00 p. m. en Bogotá
  const night = new Date("2026-11-21T08:48:00Z"); // 3:48 a. m. en Bogotá
  const at = (base: Date, s: number) => new Date(base.getTime() - s * 1000);
  const line = (over: Partial<import("./send-policy").GateLine>) => ({ direction: "OUTBOUND", isAutoReply: false, source: null, clientKey: null, sentAt: at(noon, 5), ...over });

  test("Kate/Yanet: Dayana acaba de escribir → «¿pudiste hablar?» espera; el de 1 h no sale", () => {
    expect(decideProactive({ kind: "call_check", now: noon, personTz: BOG, recent: [line({})] }).action).toBe("defer");
    expect(decideProactive({ kind: "reminder_1h", now: noon, personTz: BOG, recent: [line({})] }).action).toBe("skip");
  });
  test("la persona acaba de escribir: la IA le contesta primero", () => {
    expect(decideProactive({ kind: "quote_follow_up", now: noon, personTz: BOG, recent: [line({ direction: "INBOUND", sentAt: at(noon, 60) })] }).action).toBe("defer");
  });
  test("Jm: otro automático hace 5 min → espera; un recordatorio a hora fija sí sale", () => {
    const reminder = line({ isAutoReply: true, source: "recordatorio:1h:x", sentAt: at(noon, 300) });
    expect(decideProactive({ kind: "call_check", now: noon, personTz: BOG, recent: [reminder] }).action).toBe("defer");
    expect(decideProactive({ kind: "reminder_1h", now: noon, personTz: BOG, recent: [reminder] }).action).toBe("send");
  });
  test("Manuel/Leiner: de noche el reagendamiento espera al día; el recordatorio de 24 h no", () => {
    expect(decideProactive({ kind: "reschedule", now: night, personTz: BOG, recent: [] })).toEqual({ action: "defer", why: "de noche en su zona" });
    expect(decideProactive({ kind: "reminder_24h", now: night, personTz: BOG, recent: [] }).action).toBe("send");
  });
  test("nada pasa: sale; una respuesta de la IA no frena nada", () => {
    expect(decideProactive({ kind: "call_check", now: noon, personTz: BOG, recent: [line({ isAutoReply: true, sentAt: at(noon, 60) })] }).action).toBe("send");
    expect(decideProactive({ kind: "quote_follow_up", now: noon, personTz: BOG, recent: [] }).action).toBe("send");
  });
});
