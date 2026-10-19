import { describe, expect, test } from "bun:test";

import { clockInText, clockLabel, dayanaOfferedSlot, findFreeSlots, matchesWish, pickFreeCallSlots, readClock, relaxedWishes, saidPartOfDay, wishFromWords } from "./slots";

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

describe("juntar las llamadas (Dayana, 19-oct: respiro 0, antelación 0, «lo más que se pueda en una hora»)", () => {
  const packed = { ...config, minNoticeHours: 0 };
  // Miércoles 21: llamadas a las 8:00, 8:30 y 9:00 (como las dejó el respiro de 15 min).
  const wed = (hm: string) => new Date(`2026-10-21T${hm}:00-05:00`).getTime();
  const busy = [
    { start: wed("08:00"), end: wed("08:15") },
    { start: wed("08:30"), end: wed("08:45") },
    { start: wed("09:00"), end: wed("09:15") },
  ];
  const slots = findFreeSlots({ config: packed, durationMin: 15, busy, timezone: TZ, now: monday9, limit: 2000 });
  const at = (dateKey: string, time: string) => slots.find((s) => s.dateKey === dateKey && s.time === time);

  test("los huecos entre dos llamadas quedan libres y marcados como pegados por los dos lados", () => {
    expect(at("2026-10-21", "08:15")?.snug).toBe(2);
    expect(at("2026-10-21", "08:45")?.snug).toBe(2);
    expect(at("2026-10-21", "09:15")?.snug).toBe(1);
    expect(at("2026-10-21", "10:00")?.snug).toBe(0);
    expect(at("2026-10-21", "08:00")).toBeUndefined();
  });

  test("con antelación 0, nada que empiece en menos de 15 minutos", () => {
    // Son las 9:00 del lunes: la primera es 9:15, nunca 9:00.
    expect(slots[0]).toMatchObject({ dateKey: "2026-10-19", time: "09:15" });
    const at905 = findFreeSlots({ config: packed, durationMin: 15, busy: [], timezone: TZ, now: new Date("2026-10-19T14:05:00Z"), limit: 5 });
    expect(at905[0]?.time).toBe("09:30");
  });

  test("lo último que cabe antes de una cita (una sesión a las 11:10 → 10:55)", () => {
    const session = [{ start: wed("11:10"), end: wed("12:10") }];
    const s = findFreeSlots({ config: packed, durationMin: 15, busy: session, timezone: TZ, now: monday9, limit: 2000 });
    const times = s.filter((x) => x.dateKey === "2026-10-21" && x.time >= "10:30" && x.time <= "12:30").map((x) => x.time);
    expect(times).toEqual(["10:30", "10:45", "10:55", "12:10", "12:15", "12:30"]);
    expect(s.find((x) => x.dateKey === "2026-10-21" && x.time === "10:55")?.snug).toBe(1);
  });

  test("ofrece primero los huecos entre llamadas", () => {
    const picked = pickFreeCallSlots(slots, { ...base, soonFirst: false, compact: true });
    expect(picked.map((s) => `${s.dateKey} ${s.time}`)).toEqual(["2026-10-21 08:15", "2026-10-21 08:45", "2026-10-21 09:15"]);
    // Sin juntar, como antes: repartidas por días.
    const spread = pickFreeCallSlots(slots, { ...base, soonFirst: false });
    expect(new Set(spread.map((s) => s.dateKey)).size).toBe(3);
  });

  test("hoy o mañana sigue primero; dentro de hoy, las pegadas a una cita", () => {
    const today = [{ start: new Date("2026-10-19T15:00:00-05:00").getTime(), end: new Date("2026-10-19T15:15:00-05:00").getTime() }];
    const s = findFreeSlots({ config: packed, durationMin: 15, busy: [...busy, ...today], timezone: TZ, now: monday9, limit: 2000 });
    const picked = pickFreeCallSlots(s, { ...base, compact: true });
    expect(picked.map((x) => `${x.dateKey} ${x.time}`)).toEqual(["2026-10-19 14:45", "2026-10-19 15:15", "2026-10-20 08:00"]);
  });

  test("un día con el tope de llamadas no se ofrece aunque tenga huecos", () => {
    const picked = pickFreeCallSlots(slots, { ...base, soonFirst: false, compact: true, fullDays: new Set(["2026-10-21"]) });
    expect(picked.some((s) => s.dateKey === "2026-10-21")).toBe(false);
  });
});

describe("una hora exacta que propone la persona («¿puede ser a las 3:15?»)", () => {
  test("readClock", () => {
    expect(readClock("15:15")).toEqual(["15:15"]);
    expect(readClock("3:15 p. m.")).toEqual(["15:15"]);
    expect(readClock("3:15")).toEqual(["03:15", "15:15"]);
    expect(readClock("9 am")).toEqual(["09:00"]);
    expect(readClock("12:30")).toEqual(["12:30"]);
    expect(readClock("cuando sea")).toEqual([]);
  });

  test("clockInText: la hora que propone en el mensaje", () => {
    expect(clockInText(["Entonces mañana a las 4 de la tarde, ¿puede ser?"])).toBe("4:00 pm");
    expect(clockInText(["¿Y mañana a las 10:30 no se puede?"])).toBe("10:30");
    expect(clockInText(["tipo 3pm me queda bien"])).toBe("3:00 pm");
    expect(clockInText(["a las 9 de la mañana"])).toBe("9:00 am");
    expect(clockInText(["mejor el jueves a la 1"])).toBe("1:00");
    // La última del mensaje: «no a las 10, mejor a las 4».
    expect(clockInText(["a las 10 no puedo, mejor a las 4"])).toBe("4:00");
    // No es una hora exacta.
    expect(clockInText(["después de las 4"])).toBeNull();
    expect(clockInText(["desde las 3 estoy libre"])).toBeNull();
    expect(clockInText(["hasta las 6 trabajo"])).toBeNull();
    expect(clockInText(["no puedo a las 10"])).toBeNull();
    expect(clockInText(["me sirven las 2 opciones"])).toBeNull();
    expect(clockInText(["sí, la primera"])).toBeNull();
    // Del último mensaje que tenga una.
    expect(clockInText(["a las 4", "sí, perfecto"])).toBe("4:00");
    expect(readClock("4:00 pm")).toEqual(["16:00"]);
  });

  test("con la hora, la franja sobra; y solo esa hora encaja", () => {
    const wish = wishFromWords({ dias: ["miércoles"], hora: "3:15", franja: "mañana" }, TZ, monday9);
    expect(wish).toEqual({ weekdays: [3], times: ["03:15", "15:15"] });
    const ok = all().filter((s) => matchesWish(s, wish, TZ));
    expect(ok.map((s) => `${s.dateKey} ${s.time}`)).toEqual(["2026-10-21 15:15", "2026-10-28 15:15"]);
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

describe("clockLabel (la hora que propuso, como la escribe la asistente)", () => {
  test("a. m. y p. m.", () => {
    expect(clockLabel("16:00")).toBe("4:00 p. m.");
    expect(clockLabel("10:30")).toBe("10:30 a. m.");
    expect(clockLabel("12:15")).toBe("12:15 p. m.");
    expect(clockLabel("00:30")).toBe("12:30 a. m.");
  });
});
