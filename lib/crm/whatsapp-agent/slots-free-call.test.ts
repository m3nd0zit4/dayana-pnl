import { describe, expect, test } from "bun:test";

import { findFreeSlots, matchesWish, pickFreeCallSlots, wishFromWords } from "./slots";

const TZ = "America/Bogota";
// Lunes 8:00 a 6:00 p. m., todos los días de la semana.
const config = {
  hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, from: "08:00", to: "18:00" })),
  bufferMin: 0,
  minNoticeHours: 3,
  horizonDays: 14,
};
// Lunes 2026-10-19, 9:00 a. m. en Bogotá.
const monday9 = new Date("2026-10-19T14:00:00Z");
const all = (now = monday9) => findFreeSlots({ config, durationMin: 15, busy: [], timezone: TZ, now, limit: 2000 });
const days = (slots: { dateKey: string }[]) => slots.map((s) => s.dateKey);
const base = { count: 3, timezone: TZ, now: monday9, soonFirst: true, preferredWeekdays: [] as number[] };

describe("pickFreeCallSlots (17-oct: hoy o mañana primero, luego los días preferidos)", () => {
  test("con espacio hoy y mañana, las tres opciones salen de ahí y varían la franja", () => {
    const picked = pickFreeCallSlots(all(), base);
    expect(days(picked).every((d) => d === "2026-10-19" || d === "2026-10-20")).toBe(true);
    // Hoy la primera es a las 12:00 (antelación de 3 h), mañana a las 8:00 y otra de hoy en otra franja.
    expect(picked.map((s) => `${s.dateKey} ${s.time}`)).toEqual(["2026-10-19 12:00", "2026-10-20 08:00", "2026-10-20 12:00"]);
  });

  test("sin hoy/mañana primero, van los días preferidos", () => {
    const picked = pickFreeCallSlots(all(), { ...base, soonFirst: false, preferredWeekdays: [5] });
    expect(days(picked)).toEqual(["2026-10-23", "2026-10-23", "2026-10-30"]);
  });

  test("hoy y mañana llenos: los días preferidos antes que el resto", () => {
    const fullDays = new Set(["2026-10-19", "2026-10-20"]);
    const picked = pickFreeCallSlots(all(), { ...base, preferredWeekdays: [4], fullDays });
    // Los jueves 22 y 29 (preferidos), no el día siguiente libre.
    expect(days(picked)).toEqual(["2026-10-22", "2026-10-22", "2026-10-29"]);
  });

  test("sin espacio en los preferidos, se completa con otros días", () => {
    const slots = all().filter((s) => new Date(`${s.dateKey}T12:00:00Z`).getUTCDay() !== 6);
    const picked = pickFreeCallSlots(slots, { ...base, soonFirst: false, preferredWeekdays: [6] });
    expect(picked).toHaveLength(3);
  });

  test("solo hay una hora hoy: se completa con los preferidos", () => {
    const slots = all().filter((s) => s.dateKey !== "2026-10-20" && !(s.dateKey === "2026-10-19" && s.time !== "17:45"));
    const picked = pickFreeCallSlots(slots, { ...base, preferredWeekdays: [3] });
    expect(picked.map((s) => s.dateKey)).toEqual(["2026-10-19", "2026-10-21", "2026-10-28"]);
  });
});

describe("cuando puede la persona (wishFromWords + matchesWish)", () => {
  test("«solo los martes en la tarde»", () => {
    const wish = wishFromWords({ dias: ["martes"], franja: "tarde" }, TZ, monday9);
    const ok = all().filter((s) => matchesWish(s, wish, TZ));
    expect(new Set(days(ok))).toEqual(new Set(["2026-10-20", "2026-10-27"]));
    expect(ok.every((s) => s.time >= "12:00")).toBe(true);
  });

  test("«hoy no puedo», «mañana», fecha y «la otra semana»", () => {
    expect(wishFromWords({ noPuede: ["hoy"] }, TZ, monday9)).toEqual({ notDates: ["2026-10-19"] });
    expect(wishFromWords({ dias: ["Mañana", "miércoles", "2026-10-30"] }, TZ, monday9)).toEqual({
      weekdays: [3],
      dates: ["2026-10-20", "2026-10-30"],
    });
    const nextWeek = wishFromWords({ desde: "2026-10-26" }, TZ, monday9);
    expect(all().filter((s) => matchesWish(s, nextWeek, TZ)).every((s) => s.dateKey >= "2026-10-26")).toBe(true);
    // Lo que no se entiende no filtra nada.
    expect(wishFromWords({ dias: ["cuando sea"], franja: "madrugada" }, TZ, monday9)).toEqual({});
  });

  test("se mira en la hora de la persona (CDMX va una hora detrás de Bogotá)", () => {
    const wish = wishFromWords({ franja: "mañana" }, "America/Mexico_City", monday9);
    const ok = all().filter((s) => matchesWish(s, wish, "America/Mexico_City"));
    // 12:00 en Bogotá = 11:00 en CDMX: mañana para ella.
    expect(ok.some((s) => s.dateKey === "2026-10-19" && s.time === "12:00")).toBe(true);
    expect(ok.some((s) => s.time === "13:00")).toBe(false);
  });
});
