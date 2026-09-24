import { describe, expect, test } from "bun:test";
import { buildDiagnosticSignals, describeSignals, dayPartOf, pickTimezone } from "./diagnostic-signals";

const base = {
  answers: { orientacion: "pesa", "foco-emocional": "duelo", tiempo: "anios" },
  profile: "sanacion",
  urgencyScore: 8,
  commitmentScore: 5,
  phoneCountry: "CO",
  contactTimezone: "America/Bogota",
  clientTimezone: null,
  ipCountry: null,
  ipCity: null,
  ipTimezone: null,
};

describe("diagnostic signals", () => {
  test("3 a. m. en Colombia es madrugada", () => {
    const s = buildDiagnosticSignals({ ...base, completedAt: new Date("2026-09-24T08:05:00Z") });
    expect(s.localTime).toBe("03:05");
    expect(s.lateNight).toBe(true);
    expect(s.dayPart).toBe("madrugada");
    expect(s.answers.find((a) => a.answer === "Un duelo o algo que no he soltado")).toBeTruthy();
    expect(describeSignals(s)).toContain("MADRUGADA");
  });

  test("the browser wins: Colombian number living in Madrid", () => {
    const s = buildDiagnosticSignals({
      ...base,
      clientTimezone: "Europe/Madrid",
      ipCountry: "ES",
      ipCity: "Madrid",
      completedAt: new Date("2026-09-24T08:05:00Z"),
    });
    expect(s.timezone).toBe("Europe/Madrid");
    expect(s.localTime).toBe("10:05");
    expect(s.lateNight).toBe(false);
    expect(s.abroad).toBe(true);
    expect(describeSignals(s)).toContain("fuera de su país");
  });

  test("Bogotá default does not win against another country", () => {
    expect(pickTimezone({ contactTimezone: "America/Bogota", countryIso: "MX" }).timezone).toBe(
      "America/Mexico_City"
    );
    expect(pickTimezone({ clientTimezone: "Not/AZone", ipTimezone: "America/Lima" }).source).toBe("ip");
  });

  test("day parts", () => {
    expect(dayPartOf(0)).toBe("madrugada");
    expect(dayPartOf(9)).toBe("mañana");
    expect(dayPartOf(15)).toBe("tarde");
    expect(dayPartOf(22)).toBe("noche");
  });
});
