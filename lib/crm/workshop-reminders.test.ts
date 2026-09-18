import { describe, expect, test } from "bun:test";

import { reminderDue } from "./workshop-reminders";

const NOW = new Date("2026-09-18T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const at = (msFromNow: number): Date => new Date(NOW.getTime() + msFromNow);

describe("reminderDue — pase 24h (ventana: >2h y <=24h antes)", () => {
  test("dentro de la ventana", () => {
    expect(reminderDue("24h", at(10 * HOUR_MS), NOW)).toBe(true);
  });

  test("límite superior inclusive: exactamente 24h antes", () => {
    expect(reminderDue("24h", at(24 * HOUR_MS), NOW)).toBe(true);
  });

  test("justo por encima de 24h: todavía no entra", () => {
    expect(reminderDue("24h", at(24 * HOUR_MS + 1), NOW)).toBe(false);
  });

  test("límite inferior exclusive: exactamente 2h antes no entra (lo cubre el pase de 1h)", () => {
    expect(reminderDue("24h", at(2 * HOUR_MS), NOW)).toBe(false);
  });

  test("justo por encima de 2h: sí entra", () => {
    expect(reminderDue("24h", at(2 * HOUR_MS + 1), NOW)).toBe(true);
  });

  test("ya empezado: no entra", () => {
    expect(reminderDue("24h", at(-1), NOW)).toBe(false);
  });

  test("empieza ahora mismo: no entra", () => {
    expect(reminderDue("24h", NOW, NOW)).toBe(false);
  });
});

describe("reminderDue — pase 1h (ventana: >0 y <=1h antes)", () => {
  test("dentro de la ventana", () => {
    expect(reminderDue("1h", at(30 * 60 * 1000), NOW)).toBe(true);
  });

  test("límite superior inclusive: exactamente 1h antes", () => {
    expect(reminderDue("1h", at(HOUR_MS), NOW)).toBe(true);
  });

  test("justo por encima de 1h: todavía no entra", () => {
    expect(reminderDue("1h", at(HOUR_MS + 1), NOW)).toBe(false);
  });

  test("ya empezado: no entra", () => {
    expect(reminderDue("1h", at(-1), NOW)).toBe(false);
  });

  test("empieza ahora mismo: no entra", () => {
    expect(reminderDue("1h", NOW, NOW)).toBe(false);
  });

  test("faltan segundos: entra", () => {
    expect(reminderDue("1h", at(30 * 1000), NOW)).toBe(true);
  });
});
