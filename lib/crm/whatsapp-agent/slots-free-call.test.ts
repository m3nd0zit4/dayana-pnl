import { describe, expect, test } from "bun:test";

import { dayanaOfferedSlot, findFreeSlots, hourLimitsFrom, matchesWish, saysCantMakeIt, pickFreeCallSlots, relaxedWishes, saidPartOfDay, wishFromWords } from "./slots";

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
  test("con espacio hoy/mañana y más adelante: dos de lo antes posible y dos de más adelante (12-nov)", () => {
    const picked = pickFreeCallSlots(all(), base);
    // Hoy la primera es a las 12:00 (antelación de 3 h), mañana a las 8:00; luego dos días distintos.
    expect(picked.map((s) => `${s.dateKey} ${s.time}`)).toEqual(["2026-10-19 12:00", "2026-10-20 08:00", "2026-10-21 08:00", "2026-10-22 08:00"]);
    // Los de más adelante, primero los días preferidos.
    expect(days(pickFreeCallSlots(all(), { ...base, preferredWeekdays: [5] }))).toEqual(["2026-10-19", "2026-10-20", "2026-10-23", "2026-10-30"]);
  });

  test("solo hay espacio hoy y mañana: las de siempre, de ahí", () => {
    const soonOnly = all().filter((s) => s.dateKey === "2026-10-19" || s.dateKey === "2026-10-20");
    expect(pickFreeCallSlots(soonOnly, base).map((s) => `${s.dateKey} ${s.time}`)).toEqual(["2026-10-19 12:00", "2026-10-20 08:00", "2026-10-20 12:00"]);
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

describe("hourLimitsFrom (Carito, 9 y 12-nov: le salieron las 12:00)", () => {
  test("lo que dijo de sus horas, lo más nuevo primero", () => {
    expect(hourLimitsFrom(["Corazón después de las 5 pm por favor"])).toEqual({ fromTime: "17:00" });
    expect(hourLimitsFrom(["después de las 5"])).toEqual({ fromTime: "17:00" });
    expect(hourLimitsFrom(["Mi Dayana mi trabajo va desde 7 am a 4 pm entonces en tu horario no podría"])).toEqual({ fromTime: "16:30" });
    expect(hourLimitsFrom(["salgo a las 6"])).toEqual({ fromTime: "18:30" });
    expect(hourLimitsFrom(["trabajo hasta las 5"])).toEqual({ fromTime: "17:30" });
    expect(hourLimitsFrom(["antes de las 10 am"])).toEqual({ toTime: "10:00" });
    expect(hourLimitsFrom(["no puedo a mediodía por mi trabajo"])).toEqual({ avoidMidday: true });
    // Lo más nuevo manda.
    expect(hourLimitsFrom(["después de las 6 pm", "después de las 5 pm"])).toEqual({ fromTime: "18:00" });
    // Un saludo o una hora suelta no limita.
    expect(hourLimitsFrom(["Buenas tardes", "la llamada fue a las 3"])).toEqual({});
  });
  test("las horas que le sirven: con «después de las 5», nada de mediodía", () => {
    const limits = hourLimitsFrom(["no puedo a mediodía por mi trabajo", "Corazón después de las 5 pm por favor"]);
    const picked = all().filter((s) => matchesWish(s, limits, TZ));
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((s) => s.time >= "17:00")).toBe(true);
    // Lo que no puede se respeta al relajar.
    expect(relaxedWishes({ ...limits, weekdays: [5], partOfDay: "noche" }).every((r) => r.wish.fromTime === "17:00")).toBe(true);
  });
});

describe("saysCantMakeIt (Carito, 12 y 13-nov)", () => {
  const booked = { hm: "12:00" };
  test("no puede a esa hora, pide cambiarla o dice otra hora: se le buscan horas", () => {
    for (const t of [
      "🎤 Hola, buenos días, recuerda hoy es que no puedo a mediodía por mi trabajo",
      "Recuerda que es a la 7 pm gracias",
      "¿Podemos cambiar la llamada?",
      "¿La puedo mover para mañana?",
      "Mejor otro día",
      "Se me complicó, tengo un compromiso",
      "no puedo a esa hora",
    ]) {
      expect([t, saysCantMakeIt([t], booked)]).toEqual([t, true]);
    }
  });
  test("lo demás no (revisión 13-nov: «no puedo esperar», confirmar la hora que ya tiene)", () => {
    for (const t of [
      "Sí, ahí estaré",
      "Gracias",
      "No puedo pagar todavía",
      "Ok perfecto 👍",
      "no puedo esperar a hablar con ella",
      "no puedo creer que me llame",
      "no puedo hablar ahora, mejor luego te escribo",
      "quedamos a las 12 entonces",
      "Perfecto, es a las 12",
      "ya tengo cita con Dayana",
    ]) {
      expect([t, saysCantMakeIt([t], booked)]).toEqual([t, false]);
    }
    // La misma hora de su cita (19:15) dicha como «7 pm» es confirmarla.
    expect(saysCantMakeIt(["Recuerda que es a la 7 pm gracias"], { hm: "19:15" })).toBe(false);
  });
});

describe("hourLimitsFrom: casos de revisión (13-nov)", () => {
  test("no confunde plazos, otras frases ni días en particular", () => {
    for (const t of [
      "después de las 2 semanas te escribo",
      "hasta las 3 semanas",
      "Sale, a las 3 me queda bien",
      "mi hija sale a las 3 del colegio",
      "el horario de 3 a 5 me sirve",
      "estoy libre a las 3",
      "los lunes trabajo de 8 a 12",
      "después de las vacaciones",
    ]) {
      expect([t, hourLimitsFrom([t])]).toEqual([t, {}]);
    }
  });
  test("a. m./p. m. y «de la mañana»", () => {
    expect(hourLimitsFrom(["después de las 7 de la mañana"])).toEqual({ fromTime: "07:00" });
    expect(hourLimitsFrom(["después de las 8 de la noche"])).toEqual({ fromTime: "20:00" });
    expect(hourLimitsFrom(["después de las 5 p. m."])).toEqual({ fromTime: "17:00" });
    expect(hourLimitsFrom(["salgo a las 4 a mi casa"])).toEqual({ fromTime: "16:30" });
    expect(hourLimitsFrom(["estoy libre desde las 5"])).toEqual({ fromTime: "17:00" });
  });
});
