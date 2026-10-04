import { describe, expect, test } from "bun:test";

import { SCHEDULE_REGIONS, SCHEDULE_TBD, scheduleBlock, scheduleTemplateLines, scheduleVars } from "./event-schedule";

describe("scheduleVars — la hora en cada país", () => {
  test("domingo 4 de octubre de 2026, 14:30 UTC", () => {
    const v = scheduleVars(new Date("2026-10-04T14:30:00Z"));
    expect(v.hora_co).toBe("9:30 a. m.");
    expect(v.hora_mx).toBe("8:30 a. m.");
    expect(v.hora_ve).toBe("10:30 a. m.");
    expect(v.hora_ar).toBe("11:30 a. m.");
    expect(v.hora_us_este).toBe("10:30 a. m.");
    expect(v.hora_us_oeste).toBe("7:30 a. m.");
    expect(v.hora_eu).toBe("4:30 p. m.");
    expect(v.hora_uk).toBe("3:30 p. m.");
    // Chile ya está en horario de verano (desde septiembre).
    expect(v.hora_cl).toBe("11:30 a. m.");
  });

  test("en enero cambia el horario de verano (EE. UU. y Europa sin él, Chile con él)", () => {
    const v = scheduleVars(new Date("2026-01-15T14:30:00Z"));
    expect(v.hora_co).toBe("9:30 a. m.");
    expect(v.hora_us_este).toBe("9:30 a. m.");
    expect(v.hora_us_oeste).toBe("6:30 a. m.");
    expect(v.hora_eu).toBe("3:30 p. m.");
    expect(v.hora_uk).toBe("2:30 p. m.");
    expect(v.hora_cl).toBe("11:30 a. m.");
  });

  test("si allí ya es otro día, lo dice", () => {
    // 8:00 p. m. del domingo en Colombia = lunes 5 de madrugada en Europa.
    const v = scheduleVars(new Date("2026-10-05T01:00:00Z"));
    expect(v.hora_co).toBe("8:00 p. m.");
    expect(v.hora_eu).toBe("3:00 a. m. (lun 5)");
    expect(v.hora_uk).toBe("2:00 a. m. (lun 5)");
    expect(v.hora_us_oeste).toBe("6:00 p. m.");
  });

  test("sin hora: todas «por confirmar»", () => {
    const v = scheduleVars(new Date("2026-10-04T17:00:00Z"), { hasTime: false });
    expect(Object.values(v)).toEqual(SCHEDULE_REGIONS.map(() => SCHEDULE_TBD));
    expect(Object.values(scheduleVars(null)).every((x) => x === SCHEDULE_TBD)).toBe(true);
  });

  test("los valores caben en una variable de WhatsApp (sin saltos ni 4 espacios)", () => {
    for (const value of Object.values(scheduleVars(new Date("2026-10-05T01:00:00Z")))) {
      expect(value).not.toMatch(/[\n\t]| {4,}/);
    }
  });
});

describe("líneas del horario", () => {
  test("una por región, en orden, con la misma etiqueta en la plantilla y en el texto", () => {
    const lines = scheduleTemplateLines().split("\n");
    expect(lines).toHaveLength(SCHEDULE_REGIONS.length);
    expect(lines[0]).toBe("🇨🇴 🇵🇪 🇪🇨 🇵🇦 ➜ {{hora_co}}");
    expect(lines.at(-1)).toBe("🇬🇧 🇵🇹 ➜ {{hora_uk}}");
    const block = scheduleBlock(new Date("2026-10-04T14:30:00Z")).split("\n");
    expect(block[0]).toBe("🇨🇴 🇵🇪 🇪🇨 🇵🇦 ➜ 9:30 a. m.");
    expect(block[5]).toBe("🇺🇸 Costa Este ➜ 10:30 a. m.");
  });
});
