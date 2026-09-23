import { describe, expect, test } from "bun:test";

import {
  findFreeSlots,
  isWithinBookingHours,
  spreadSlots,
  type Busy,
} from "./slots";

const TZ = "America/Bogota";
const config = {
  hours: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    from: "09:00",
    to: "12:00",
  })),
  bufferMin: 15,
  minNoticeHours: 2,
  horizonDays: 7,
};

// Lunes 2026-09-28 06:00 en Bogotá (11:00 UTC).
const monday6am = new Date("2026-09-28T11:00:00Z");
const at = (iso: string) => new Date(iso).getTime();

describe("findFreeSlots", () => {
  test("respeta la antelación mínima y el horario", () => {
    const slots = findFreeSlots({
      config,
      durationMin: 60,
      busy: [],
      timezone: TZ,
      now: monday6am,
    });
    // Antelación de 2 h → nada antes de las 08:00; el horario empieza a las 09:00.
    expect(slots[0].dateKey).toBe("2026-09-28");
    expect(slots[0].time).toBe("09:00");
    // La última del día termina a las 12:00 como mucho.
    const mondays = slots.filter((s) => s.dateKey === "2026-09-28");
    expect(mondays.at(-1)?.time).toBe("11:00");
  });

  test("no ofrece horas pegadas a algo ocupado (respiro a los dos lados)", () => {
    const busy: Busy[] = [
      // 10:00–10:30 Bogotá
      { start: at("2026-09-28T15:00:00Z"), end: at("2026-09-28T15:30:00Z") },
    ];
    const times = findFreeSlots({
      config,
      durationMin: 60,
      busy,
      timezone: TZ,
      now: monday6am,
    })
      .filter((s) => s.dateKey === "2026-09-28")
      .map((s) => s.time);
    // 09:00–10:00 + 15 min de respiro choca con las 10:00; 10:30 termina a
    // las 11:30, pero el respiro de antes pisa el ocupado; 11:00 es la primera.
    expect(times).toEqual(["11:00"]);
  });

  test("salta los fines de semana", () => {
    const saturday = new Date("2026-10-03T11:00:00Z");
    const slots = findFreeSlots({
      config,
      durationMin: 60,
      busy: [],
      timezone: TZ,
      now: saturday,
    });
    expect(slots[0].dateKey).toBe("2026-10-05");
  });

  test("filtra por rango pedido", () => {
    const slots = findFreeSlots({
      config,
      durationMin: 20,
      busy: [],
      timezone: TZ,
      now: monday6am,
      from: new Date("2026-09-30T05:00:00Z"),
      to: new Date("2026-10-01T05:00:00Z"),
    });
    expect(new Set(slots.map((s) => s.dateKey))).toEqual(
      new Set(["2026-09-30"])
    );
  });
});

describe("findFreeSlots con bloques Disponible", () => {
  test("solo ofrece horas dentro de los bloques y libres", () => {
    const windows: Busy[] = [
      // miércoles 14:00-17:00 Bogotá
      { start: at("2026-09-30T19:00:00Z"), end: at("2026-09-30T22:00:00Z") },
    ];
    const busy: Busy[] = [
      // 15:00-15:30 ocupado
      { start: at("2026-09-30T20:00:00Z"), end: at("2026-09-30T20:30:00Z") },
    ];
    const slots = findFreeSlots({ config, durationMin: 60, busy, windows, timezone: TZ, now: monday6am });
    expect(slots.map((s) => `${s.dateKey} ${s.time}`)).toEqual(["2026-09-30 16:00"]);
  });
});

describe("spreadSlots", () => {
  test("reparte entre días distintos", () => {
    const all = findFreeSlots({
      config,
      durationMin: 60,
      busy: [],
      timezone: TZ,
      now: monday6am,
    });
    const picked = spreadSlots(all, 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((s) => s.dateKey)).size).toBe(3);
  });
});

describe("isWithinBookingHours", () => {
  test("acepta dentro del horario y rechaza fuera", () => {
    expect(
      isWithinBookingHours(config, new Date("2026-09-28T14:00:00Z"), 60, TZ)
    ).toBe(true); // 09:00
    expect(
      isWithinBookingHours(config, new Date("2026-09-28T16:30:00Z"), 60, TZ)
    ).toBe(false); // 11:30 → termina 12:30
    expect(
      isWithinBookingHours(config, new Date("2026-10-03T14:00:00Z"), 60, TZ)
    ).toBe(false); // sábado
  });
});
