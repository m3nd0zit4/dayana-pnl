import { describe, expect, test } from "bun:test";

import { registeredEventLines } from "./free-event-registration";

const NOW = Date.parse("2026-10-16T23:30:00Z");
const WEBINAR = {
  eventLabel: "Webinar Gratuito",
  headline: "Sana tu relación con el dinero",
  startsAt: new Date("2026-10-25T14:30:00Z"),
  startsAtHasTime: true,
  meetUrl: "https://meet.google.com/abc-defg-hij",
};

describe("registeredEventLines (Pricila, 16-oct: pidió el enlace y le dieron la página)", () => {
  test("inscrita con enlace de Meet: se le da el de la reunión", () => {
    const [line] = registeredEventLines([WEBINAR], NOW);
    expect(line).toContain("https://meet.google.com/abc-defg-hij");
    // Intl separa «a. m.» con espacios finos (U+202F/U+00A0).
    expect(line).toMatch(/domingo, 25 de octubre, 9:30\sa\.\sm\. hora de Colombia/);
    expect(line).toContain("no la página de inscripción");
  });

  test("sin enlace todavía: no se inventa uno ni se manda la página", () => {
    const [line] = registeredEventLines([{ ...WEBINAR, meetUrl: "  " }], NOW);
    expect(line).not.toContain("meet.google.com");
    expect(line).toContain("se lo mandamos por aquí");
  });

  test("un evento que ya pasó no cuenta", () => {
    expect(registeredEventLines([{ ...WEBINAR, startsAt: new Date("2026-10-16T18:00:00Z") }], NOW)).toEqual([]);
    // Dentro de las 3 h desde que empezó, sigue en pie (alguien entra tarde).
    expect(registeredEventLines([{ ...WEBINAR, startsAt: new Date("2026-10-16T22:00:00Z") }], NOW)).toHaveLength(1);
  });

  test("sin fecha: sigue en pie", () => {
    const [line] = registeredEventLines([{ ...WEBINAR, startsAt: null }], NOW);
    expect(line).toContain("fecha por anunciar");
  });
});
