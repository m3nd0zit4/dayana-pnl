import { describe, expect, test } from "bun:test";

import {
  defaultWhatsAppAiConfig,
  isWithinOwnerHours,
  parseWhatsAppAiConfig,
} from "./whatsapp-ai-config";

const TZ = "America/Bogota";
// 2026-09-23 es miércoles. Bogotá = UTC-5.
const bogota = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, day, hour + 5, minute));

describe("parseWhatsAppAiConfig", () => {
  test("sin nada guardado da los valores por defecto", () => {
    expect(parseWhatsAppAiConfig(null)).toEqual(defaultWhatsAppAiConfig());
  });

  test("un campo roto cae a su defecto sin tirar los demás", () => {
    const config = parseWhatsAppAiConfig(
      JSON.stringify({ maxPerDay: 999, instructions: "No hables de política" })
    );
    expect(config.maxPerDay).toBe(defaultWhatsAppAiConfig().maxPerDay);
    expect(config.instructions).toBe("No hables de política");
  });

  test("JSON inválido no rompe", () => {
    expect(parseWhatsAppAiConfig("{nope")).toEqual(defaultWhatsAppAiConfig());
  });
});

describe("recordatorio de la llamada gratis (freeCallReminder)", () => {
  test("encendido por defecto (lo pidió la dueña), 60 min antes, con {{nombre}} y {{hora}}", () => {
    const r = parseWhatsAppAiConfig(null).freeCallReminder;
    expect(r.enabled).toBe(true);
    expect(r.minutesBefore).toBe(60);
    expect(r.message).toContain("{{nombre}}");
    expect(r.message).toContain("{{hora}}");
    // Una configuración guardada antes de existir la clave también lo trae encendido.
    expect(parseWhatsAppAiConfig(JSON.stringify({ instructions: "x" })).freeCallReminder).toEqual(r);
  });

  test("los minutos fuera de 30–180 se ajustan sin perder el mensaje", () => {
    const parse = (minutesBefore: number) =>
      parseWhatsAppAiConfig(JSON.stringify({ freeCallReminder: { enabled: false, minutesBefore, message: "Hola {{nombre}}, a las {{hora}}." } }))
        .freeCallReminder;
    expect(parse(5)).toEqual({ enabled: false, minutesBefore: 30, message: "Hola {{nombre}}, a las {{hora}}." });
    expect(parse(500).minutesBefore).toBe(180);
    expect(parse(90.6).minutesBefore).toBe(91);
  });

  test("un campo roto vuelve el bloque a su defecto sin tocar el resto", () => {
    const config = parseWhatsAppAiConfig(
      JSON.stringify({ freeCallReminder: { enabled: false, message: 42 }, instructions: "No hables de política" })
    );
    expect(config.freeCallReminder).toEqual(defaultWhatsAppAiConfig().freeCallReminder);
    expect(config.instructions).toBe("No hables de política");
    // Campos que faltan toman su defecto.
    expect(parseWhatsAppAiConfig(JSON.stringify({ freeCallReminder: { enabled: false } })).freeCallReminder).toEqual({
      ...defaultWhatsAppAiConfig().freeCallReminder,
      enabled: false,
    });
  });
});

describe("isWithinOwnerHours", () => {
  const office = {
    mode: "outside_hours" as const,
    days: [1, 2, 3, 4, 5],
    start: "08:00",
    end: "18:00",
  };

  test("miércoles a mediodía está atendiendo", () => {
    expect(isWithinOwnerHours(office, bogota(23, 12), TZ)).toBe(true);
  });

  test("miércoles de noche no", () => {
    expect(isWithinOwnerHours(office, bogota(23, 20), TZ)).toBe(false);
  });

  test("la hora de fin ya no cuenta", () => {
    expect(isWithinOwnerHours(office, bogota(23, 18), TZ)).toBe(false);
  });

  test("domingo no", () => {
    expect(isWithinOwnerHours(office, bogota(27, 12), TZ)).toBe(false);
  });

  test("horario que cruza la medianoche", () => {
    const night = { ...office, days: [3], start: "22:00", end: "06:00" };
    expect(isWithinOwnerHours(night, bogota(23, 23), TZ)).toBe(true);
    expect(isWithinOwnerHours(night, bogota(24, 3), TZ)).toBe(true);
    expect(isWithinOwnerHours(night, bogota(24, 7), TZ)).toBe(false);
  });
});
