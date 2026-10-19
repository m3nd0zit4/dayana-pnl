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
    // 09:00–10:00 + 15 min de respiro choca con las 10:00; 10:30 + 15 min de
    // respiro = 10:45, la primera (19-oct: también justo después de lo ocupado).
    expect(times).toEqual(["10:45", "11:00"]);
  });

  test("respiro de 7 min (Dayana, 19-oct): después de una llamada de 12:00 a 12:15, las 12:25", () => {
    const busy: Busy[] = [{ start: at("2026-09-28T17:00:00Z"), end: at("2026-09-28T17:15:00Z") }];
    const times = findFreeSlots({ config: { ...config, bufferMin: 7, hours: [{ weekday: 1, from: "08:00", to: "18:00" }] }, durationMin: 15, busy, timezone: TZ, now: monday6am, limit: 200 })
      .filter((s) => s.dateKey === "2026-09-28" && s.time >= "11:30" && s.time <= "12:45")
      .map((s) => s.time);
    // 11:45 + 15 + 7 > 12:00 choca; 12:00 ocupado; 12:15 + 7 = 12:22 → 12:25.
    expect(times).toEqual(["11:30", "12:25", "12:30", "12:45"]);
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

  test("horario de la dueña: sin martes, jueves desde las 11:00, nada después de las 22:00", () => {
    const owner = {
      ...config,
      horizonDays: 14,
      hours: [
        { weekday: 1, from: "08:00", to: "22:00" },
        { weekday: 3, from: "08:00", to: "22:00" },
        { weekday: 4, from: "11:00", to: "22:00" },
        { weekday: 5, from: "08:00", to: "22:00" },
      ],
    };
    const slots = findFreeSlots({ config: owner, durationMin: 15, busy: [], timezone: TZ, now: monday6am, limit: 2000 });
    const weekdayOf = (dateKey: string) => new Date(`${dateKey}T12:00:00Z`).getUTCDay();
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some((s) => weekdayOf(s.dateKey) === 2)).toBe(false);
    expect(slots.some((s) => [0, 6].includes(weekdayOf(s.dateKey)))).toBe(false);
    expect(slots.filter((s) => weekdayOf(s.dateKey) === 4).every((s) => s.time >= "11:00")).toBe(true);
    expect(slots.every((s) => s.time >= "08:00" && s.time <= "21:45")).toBe(true);
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
  // The owner's schedule: no Tuesdays, nothing after 22:00 or at dawn, Thursdays from 11:00.
  const ownerHours = {
    ...config,
    hours: [
      { weekday: 1, from: "08:00", to: "22:00" },
      { weekday: 3, from: "08:00", to: "22:00" },
      { weekday: 4, from: "11:00", to: "22:00" },
      { weekday: 5, from: "08:00", to: "22:00" },
    ],
  };

  test("solo ofrece horas dentro de los bloques y libres", () => {
    const windows: Busy[] = [
      // miércoles 14:00-17:00 Bogotá
      { start: at("2026-09-30T19:00:00Z"), end: at("2026-09-30T22:00:00Z") },
    ];
    const busy: Busy[] = [
      // 15:00-15:30 ocupado
      { start: at("2026-09-30T20:00:00Z"), end: at("2026-09-30T20:30:00Z") },
    ];
    const slots = findFreeSlots({ config: ownerHours, durationMin: 60, busy, windows, timezone: TZ, now: monday6am });
    // 15:30 + 15 min de respiro = 15:45 (justo después de lo ocupado) y 16:00.
    expect(slots.map((s) => `${s.dateKey} ${s.time}`)).toEqual(["2026-09-30 15:45", "2026-09-30 16:00"]);
  });

  test("un bloque Disponible no abre horas fuera del horario de Ajustes", () => {
    const windows: Busy[] = [
      // martes 29: 10:00-12:00 Bogotá (los martes no se agenda)
      { start: at("2026-09-29T15:00:00Z"), end: at("2026-09-29T17:00:00Z") },
      // jueves 1: 09:00-12:00 Bogotá (los jueves solo desde las 11:00)
      { start: at("2026-10-01T14:00:00Z"), end: at("2026-10-01T17:00:00Z") },
      // viernes 2: 21:00 a sábado 01:00 Bogotá (nada después de las 22:00 ni de madrugada)
      { start: at("2026-10-03T02:00:00Z"), end: at("2026-10-03T06:00:00Z") },
    ];
    const slots = findFreeSlots({ config: ownerHours, durationMin: 15, busy: [], windows, timezone: TZ, now: monday6am });
    const labels = slots.map((s) => `${s.dateKey} ${s.time}`);
    expect(labels.some((l) => l.startsWith("2026-09-29"))).toBe(false);
    expect(labels.filter((l) => l.startsWith("2026-10-01")).every((l) => l.slice(11) >= "11:00")).toBe(true);
    expect(labels.filter((l) => l.startsWith("2026-10-01")).length).toBeGreaterThan(0);
    const friday = labels.filter((l) => l.startsWith("2026-10-02"));
    expect(friday.length).toBeGreaterThan(0);
    expect(friday.every((l) => l.slice(11) <= "21:45")).toBe(true);
    expect(labels.some((l) => l.startsWith("2026-10-03"))).toBe(false);
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
