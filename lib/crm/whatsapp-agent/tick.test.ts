import { describe, expect, test } from "bun:test";

import {
  CLOCK_FOLLOWUP_EVERY_MS,
  CLOCK_FOLLOWUP_KEY,
  CLOCK_REMINDERS_EVERY_MS,
  CLOCK_REMINDERS_KEY,
  CLOCK_SYNC_EVERY_MS,
  CLOCK_SYNC_KEY,
  clockSlotDue,
  isClockHost,
  parseClockValue,
} from "./tick";

describe("turnos del reloj pegado a los avisos", () => {
  test("lo guardado se lee como milisegundos; lo que no se entiende cuenta como «nunca»", () => {
    expect(parseClockValue("1760652900000")).toBe(1760652900000);
    expect(parseClockValue(" 1760652900000 ")).toBe(1760652900000);
    for (const raw of [null, undefined, "", "ayer", "-5", "1.5", "9".repeat(20)]) expect(parseClockValue(raw)).toBe(0);
  });

  test("le toca cuando pasó el intervalo (citas cada 15 min, recordatorios cada 5)", () => {
    const now = 1760652900000;
    expect(clockSlotDue(0, now, CLOCK_SYNC_EVERY_MS)).toBe(true);
    expect(clockSlotDue(now - CLOCK_SYNC_EVERY_MS, now, CLOCK_SYNC_EVERY_MS)).toBe(true);
    expect(clockSlotDue(now - CLOCK_SYNC_EVERY_MS + 1, now, CLOCK_SYNC_EVERY_MS)).toBe(false);
    expect(clockSlotDue(now - 4 * 60_000, now, CLOCK_REMINDERS_EVERY_MS)).toBe(false);
    expect(clockSlotDue(now - 5 * 60_000, now, CLOCK_REMINDERS_EVERY_MS)).toBe(true);
  });

  test("el seguimiento de la llamada gratis tiene su propio turno, cada 5 min o más", () => {
    expect(new Set([CLOCK_SYNC_KEY, CLOCK_REMINDERS_KEY, CLOCK_FOLLOWUP_KEY]).size).toBe(3);
    expect(CLOCK_FOLLOWUP_EVERY_MS).toBeGreaterThanOrEqual(5 * 60_000);
    const now = 1760652900000;
    expect(clockSlotDue(now - 4 * 60_000, now, CLOCK_FOLLOWUP_EVERY_MS)).toBe(false);
    expect(clockSlotDue(now - CLOCK_FOLLOWUP_EVERY_MS, now, CLOCK_FOLLOWUP_EVERY_MS)).toBe(true);
  });

  test("solo producción hace de reloj (una Preview o el local, no)", () => {
    const before = process.env.VERCEL_ENV;
    try {
      process.env.VERCEL_ENV = "production";
      expect(isClockHost()).toBe(true);
      process.env.VERCEL_ENV = "preview";
      expect(isClockHost()).toBe(false);
      delete process.env.VERCEL_ENV;
      expect(isClockHost()).toBe(false);
    } finally {
      if (before === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = before;
    }
  });
});
