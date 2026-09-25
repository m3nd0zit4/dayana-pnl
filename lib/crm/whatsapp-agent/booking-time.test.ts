import { describe, expect, test } from "bun:test";
import { countryName, describeRequestedTime, isValidTimezone, resolvePersonTimezone } from "./booking-time";

describe("hora de la persona → hora de Colombia", () => {
  test("La Paz, Baja California Sur (UTC-7) → Colombia (UTC-5)", () => {
    const r = describeRequestedTime({ localDateTime: "2026-10-01T15:00", personTz: "America/Mazatlan", place: "México (La Paz)" });
    expect(r?.utc.toISOString()).toBe("2026-10-01T22:00:00.000Z");
    expect(r?.text).toContain("hora de México (La Paz)");
    expect(r?.text).toContain("5:00");
    expect(r?.text).toContain("en Colombia");
  });
  test("España (UTC+2 en octubre) → Colombia", () => {
    const r = describeRequestedTime({ localDateTime: "2026-10-01T18:00", personTz: "Europe/Madrid", place: "España" });
    expect(r?.utc.toISOString()).toBe("2026-10-01T16:00:00.000Z");
    expect(r?.text).toContain("11:00");
  });
  test("Colombia no se repite", () => {
    const r = describeRequestedTime({ localDateTime: "2026-10-01T10:00", personTz: "America/Bogota", place: "Colombia" });
    expect(r?.text).toContain("(hora de Colombia)");
  });
  test("formato inválido", () => {
    expect(describeRequestedTime({ localDateTime: "jueves 3pm", personTz: "America/Lima", place: "Perú" })).toBeNull();
  });
});

test("zona de la persona", () => {
  expect(resolvePersonTimezone("MX", "America/Mazatlan")).toBe("America/Mazatlan");
  expect(resolvePersonTimezone("PE", "no/existe")).toBe("America/Lima");
  expect(isValidTimezone("Europe/Madrid")).toBe(true);
  expect(countryName("MX")).toBe("México");
});
