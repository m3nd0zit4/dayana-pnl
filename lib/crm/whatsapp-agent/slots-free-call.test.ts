import { describe, expect, test } from "bun:test";

import { dayanaOfferedSlot, findFreeSlots, matchesWish, pickFreeCallSlots, relaxedWishes, saidPartOfDay, wishFromWords } from "./slots";

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

describe("sin espacio en lo que pidió: lo más parecido (Danilo, 18-oct)", () => {
  test("los mismos días a otra hora, luego la misma hora otro día, luego cualquiera", () => {
    const wish = wishFromWords({ dias: ["mañana"], franja: "tarde" }, TZ, monday9)!;
    expect(relaxedWishes(wish).map((s) => s.step)).toEqual(["exact", "same_days", "same_time", "any"]);
    const [, sameDays, sameTime, any] = relaxedWishes(wish);
    expect(sameDays!.wish.partOfDay).toBeUndefined();
    expect(sameDays!.wish.dates).toEqual(wish.dates);
    expect(sameTime!.wish.dates).toBeUndefined();
    expect(sameTime!.wish.partOfDay).toBe("tarde");
    expect(any!.wish).toEqual({ notWeekdays: undefined, notDates: undefined, fromDate: undefined });
  });

  test("lo que no puede se respeta siempre", () => {
    const wish = wishFromWords({ dias: ["martes"], noPuede: ["lunes"], franja: "tarde" }, TZ, monday9)!;
    for (const { wish: w } of relaxedWishes(wish)) expect(w.notWeekdays).toEqual([1]);
  });
});

describe("saidPartOfDay (una franja que la persona no dijo no cuenta)", () => {
  test("lo dijo", () => {
    for (const s of ["mejor en la tarde", "por la mañana", "temprano", "después de las 5", "a las 6 pm", "en las noches", "solo tarde"]) {
      expect(saidPartOfDay([s])).toBe(true);
    }
  });
  test("no lo dijo", () => {
    for (const s of ["¿Qué horarios tienes?", "mañana puedo", "Buenas tardes", "buenas noches, quiero la llamada", "La primera opción me queda perfecta"]) {
      expect(saidPartOfDay([s])).toBe(false);
    }
  });
});

describe("dayanaOfferedSlot (horas que Dayana escribió: «Horas libres» o a mano)", () => {
  const horasLibres =
    "Tengo estos espacios para consulta gratis 15 min (15 min, hora de Colombia):\n• Jueves, 15 de octubre, 6:45 p. m.\n• Viernes, 16 de octubre, 9:15 a. m.\n¿Cuál te queda mejor?";
  // Jueves 15-oct-2026, 6:45 p. m. en Bogotá = 23:45 UTC.
  test("la del botón «Horas libres»", () => {
    expect(dayanaOfferedSlot([horasLibres], "2026-10-15T23:45:00Z", "America/Bogota")).toBe(true);
    expect(dayanaOfferedSlot([horasLibres], "2026-10-16T14:15:00Z", "America/Bogota")).toBe(true);
  });
  test("a mano, con el día de la semana", () => {
    expect(dayanaOfferedSlot(["Te puedo llamar el jueves a las 6:45 pm"], "2026-10-15T23:45:00Z", "America/Bogota")).toBe(true);
  });
  test("otra hora, otro día o una hora parecida no", () => {
    expect(dayanaOfferedSlot([horasLibres], "2026-10-15T23:00:00Z", "America/Bogota")).toBe(false);
    expect(dayanaOfferedSlot([horasLibres], "2026-10-22T23:45:00Z", "America/Bogota")).toBe(false);
    expect(dayanaOfferedSlot(["el jueves a las 16:45 pm"], "2026-10-15T23:45:00Z", "America/Bogota")).toBe(false);
  });
});
