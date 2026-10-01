import { describe, expect, test } from "bun:test";

import {
  eventConfirmationText,
  eventFecha,
  eventReminderText,
  eventReminderVars,
  greetingName,
  reminderZone,
  waReminderDue,
} from "./event-reminder-text";

const BOG = "America/Bogota";
// Domingo 4 de octubre de 2026, 9:30 a. m. en Bogotá.
const START = new Date("2026-10-04T14:30:00Z");
const MEET = "https://meet.google.com/abc-defg-hij";

const fecha = (zone: ReturnType<typeof reminderZone>, pass: "24h" | "1h" = "24h", hasTime = true) =>
  eventFecha({ startsAt: START, startsAtHasTime: hasTime, pass, opTz: BOG, zone });

describe("reminderZone", () => {
  test("Bogotá por defecto + número colombiano → Colombia", () => {
    expect(reminderZone({ timezone: BOG, phoneE164: "+573001234567" }, BOG)).toEqual({
      tz: BOG,
      countryIso: "CO",
    });
  });
  test("número +52 con la zona por defecto → Ciudad de México", () => {
    expect(reminderZone({ timezone: BOG, phoneE164: "+5215512345678" }, BOG).tz).toBe("America/Mexico_City");
  });
  test("una zona elegida (no Bogotá) gana al número", () => {
    expect(reminderZone({ timezone: "Europe/Madrid", phoneE164: "+573001234567" }, BOG)).toEqual({
      tz: "Europe/Madrid",
      countryIso: "ES",
    });
  });
  test("el país del teléfono guardado manda sobre el prefijo", () => {
    expect(reminderZone({ timezone: BOG, phoneE164: "+51987654321", phoneCountryIso: "PE" }, BOG).tz).toBe(
      "America/Lima"
    );
  });
  test("sin datos → la zona de Dayana", () => {
    expect(reminderZone({ timezone: null, phoneE164: "+pending:abc" }, BOG).tz).toBe(BOG);
  });
});

describe("eventFecha", () => {
  test("Colombia: día de la semana, hora y «hora de Colombia», nada más", () => {
    const f = fecha(reminderZone({ timezone: BOG, phoneE164: "+573001234567" }, BOG));
    expect(f).toBe("domingo 4 de octubre a las 9:30 a. m. (hora de Colombia)");
  });
  test("México: añade su hora", () => {
    const f = fecha(reminderZone({ phoneE164: "+5215512345678" }, BOG));
    expect(f).toBe("domingo 4 de octubre a las 9:30 a. m. (hora de Colombia), 8:30 a. m. en México");
  });
  test("España: su hora (misma fecha)", () => {
    const f = fecha(reminderZone({ phoneE164: "+34612345678" }, BOG));
    expect(f).toBe("domingo 4 de octubre a las 9:30 a. m. (hora de Colombia), 4:30 p. m. en España");
  });
  test("Perú: misma hora que Colombia → no se repite", () => {
    const f = fecha(reminderZone({ phoneE164: "+51987654321" }, BOG));
    expect(f).toBe("domingo 4 de octubre a las 9:30 a. m. (hora de Colombia)");
  });
  test("si allí ya es otro día, lo dice con su día de la semana", () => {
    const late = new Date("2026-10-04T23:00:00Z"); // 6:00 p. m. Bogotá = lunes en Madrid
    const f = eventFecha({
      startsAt: late,
      startsAtHasTime: true,
      pass: "24h",
      opTz: BOG,
      zone: reminderZone({ phoneE164: "+34612345678" }, BOG),
    });
    expect(f).toBe("domingo 4 de octubre a las 6:00 p. m. (hora de Colombia), lunes 5 de octubre a las 1:00 a. m. en España");
  });
  test("1 h: termina en «(en 1 hora)»", () => {
    const f = fecha(reminderZone({ phoneE164: "+573001234567" }, BOG), "1h");
    expect(f.endsWith(" (en 1 hora)")).toBe(true);
    expect(fecha(reminderZone({ phoneE164: "+573001234567" }, BOG), "24h")).not.toContain("en 1 hora");
  });
  test("1 h ya empezado (envío manual): lo dice", () => {
    const f = eventFecha({
      startsAt: START,
      startsAtHasTime: true,
      pass: "1h",
      opTz: BOG,
      zone: reminderZone({ phoneE164: "+573001234567" }, BOG),
      now: new Date(START.getTime() + 5 * 60_000),
    });
    expect(f).toContain("ya empezamos");
  });
  test("sin hora: solo la fecha", () => {
    const f = fecha(reminderZone({ phoneE164: "+5215512345678" }, BOG), "24h", false);
    expect(f.startsWith("domingo 4 de octubre")).toBe(true);
    expect(f).not.toContain("a. m.");
    expect(f).not.toContain("México");
  });
  test("siempre empieza por el día de la semana y sin saltos de línea", () => {
    for (const phone of ["+573001234567", "+5215512345678", "+34612345678", "+51987654321", "+81312345678"]) {
      for (const pass of ["24h", "1h"] as const) {
        const f = fecha(reminderZone({ phoneE164: phone }, BOG), pass);
        expect(f).toMatch(/^(lunes|martes|miércoles|jueves|viernes|sábado|domingo) /);
        expect(f).not.toMatch(/[\r\n  ]/);
      }
    }
  });
});

describe("eventReminderVars / eventReminderText", () => {
  const vars = eventReminderVars({
    headline: "Reprograma tu mente\ncon PNL",
    startsAt: START,
    startsAtHasTime: true,
    meetUrl: ` ${MEET} `,
    pass: "24h",
    opTz: BOG,
    zone: reminderZone({ phoneE164: "+5215512345678" }, BOG),
  });
  test("variables de la plantilla", () => {
    expect(vars.evento).toBe("«Reprograma tu mente con PNL»");
    expect(vars.enlace).toBe(MEET);
    expect(vars.fecha).toContain("8:30 a. m. en México");
  });
  test("texto libre: mismas palabras que la plantilla, con el enlace", () => {
    const text = eventReminderText({ ...vars, nombre: "Ana" });
    expect(text).toBe(
      `Hola Ana, te recuerdo que «Reprograma tu mente con PNL» es el ${vars.fecha}. Entra aquí: ${MEET} Nos vemos pronto 💛`
    );
    expect(text).not.toMatch(/[\r\n]/);
    expect(eventReminderText({ ...vars, nombre: "" }).startsWith("Hola, te recuerdo")).toBe(true);
  });
  test("no saluda con un teléfono ni un correo", () => {
    expect(greetingName("ana maría")).toBe("Ana");
    expect(greetingName("+573001234567")).toBe("");
    expect(greetingName("ana@x.com")).toBe("");
    expect(greetingName(null)).toBe("");
  });
});

describe("waReminderDue", () => {
  const H = 3600_000;
  const at = (msBefore: number) => new Date(START.getTime() - msBefore);
  test("24 h: entre 2 h y 24 h antes (bordes)", () => {
    expect(waReminderDue("24h", START, true, at(24 * H))).toBe(true);
    expect(waReminderDue("24h", START, true, at(24 * H + 1))).toBe(false);
    expect(waReminderDue("24h", START, true, at(2 * H + 1))).toBe(true);
    expect(waReminderDue("24h", START, true, at(2 * H))).toBe(false);
  });
  test("1 h: la última hora, y solo con hora real", () => {
    expect(waReminderDue("1h", START, true, at(H))).toBe(true);
    expect(waReminderDue("1h", START, true, at(H + 1))).toBe(false);
    expect(waReminderDue("1h", START, true, at(30 * 60_000))).toBe(true);
    expect(waReminderDue("1h", START, true, at(0))).toBe(false);
    expect(waReminderDue("1h", START, false, at(30 * 60_000))).toBe(false);
  });
  test("sin fecha, nunca", () => {
    expect(waReminderDue("24h", null, true, at(10 * H))).toBe(false);
  });
});

describe("confirmación al inscribirse", () => {
  test("mismas palabras que la plantilla, con la fecha de eventFecha", () => {
    const text = eventConfirmationText({
      nombre: "Ana",
      evento: "«Reprograma tu mente»",
      fecha: fecha(reminderZone({ timezone: BOG, phoneE164: "+573001112233" }, BOG)),
    });
    expect(text).toBe(
      "Hola Ana, quedaste inscrita en «Reprograma tu mente» el domingo 4 de octubre a las 9:30 a. m. (hora de Colombia). Te mando el enlace para entrar por aquí antes de empezar."
    );
  });

  test("sin nombre, saluda sin él", () => {
    expect(eventConfirmationText({ evento: "«X»", fecha: "lunes 5 de octubre" })).toStartWith("Hola, quedaste inscrita");
  });
});
