import { describe, expect, test } from "bun:test";

import { estimateTemplateCost, rateCategory, rateGroupFor, templateRateFor } from "./whatsapp-rates";

describe("rateGroupFor", () => {
  test("cada país por su prefijo", () => {
    expect(rateGroupFor("+573001234567").key).toBe("co");
    expect(rateGroupFor("+5215512345678").key).toBe("mx");
    expect(rateGroupFor("+5491112345678").key).toBe("ar");
    expect(rateGroupFor("+5511912345678").key).toBe("br");
    expect(rateGroupFor("+56912345678").key).toBe("cl");
    expect(rateGroupFor("+51912345678").key).toBe("pe");
    expect(rateGroupFor("+34612345678").key).toBe("es");
    expect(rateGroupFor("+447700900123").key).toBe("uk");
    expect(rateGroupFor("+4915112345678").key).toBe("de");
    expect(rateGroupFor("+33612345678").key).toBe("fr");
    expect(rateGroupFor("+393123456789").key).toBe("it");
  });

  test("gana el prefijo más largo", () => {
    // 593 (Ecuador) y 591 (Bolivia) no son Perú (51) ni nada de 5x.
    expect(rateGroupFor("+593991234567").key).toBe("latam");
    expect(rateGroupFor("+59171234567").key).toBe("latam");
    expect(rateGroupFor("+595981234567").key).toBe("latam");
    expect(rateGroupFor("+50688887777").key).toBe("latam");
    expect(rateGroupFor("+584121234567").key).toBe("latam");
    // 351 (Portugal) no es 35x de otro lado ni España (34).
    expect(rateGroupFor("+351912345678").key).toBe("eu");
    expect(rateGroupFor("+41791234567").key).toBe("eu");
  });

  test("todo el +1 es Norteamérica (también República Dominicana y Puerto Rico)", () => {
    expect(rateGroupFor("+13055551234").key).toBe("na");
    expect(rateGroupFor("+18095551234").key).toBe("na");
    expect(rateGroupFor("+17875551234").key).toBe("na");
  });

  test("lo demás, o sin número: Otros", () => {
    expect(rateGroupFor("+79161234567").key).toBe("otros");
    expect(rateGroupFor("+61412345678").key).toBe("otros");
    expect(rateGroupFor(null).key).toBe("otros");
    expect(rateGroupFor("").key).toBe("otros");
  });

  test("con o sin +", () => {
    expect(rateGroupFor("573001234567").key).toBe("co");
  });
});

describe("templateRateFor", () => {
  test("por país y categoría", () => {
    expect(templateRateFor("+573001234567", "MARKETING")).toBe(0.0125);
    expect(templateRateFor("+573001234567", "UTILITY")).toBe(0.0008);
    expect(templateRateFor("+5215512345678", "UTILITY")).toBe(0.0085);
    expect(templateRateFor("+4915112345678", "MARKETING")).toBe(0.1365);
    expect(templateRateFor("+79161234567", "MARKETING")).toBe(0.0604);
  });

  test("categoría desconocida o vacía: como MARKETING", () => {
    expect(rateCategory(null)).toBe("MARKETING");
    expect(rateCategory("AUTHENTICATION")).toBe("MARKETING");
    expect(rateCategory("utility")).toBe("UTILITY");
    expect(templateRateFor("+573001234567", null)).toBe(0.0125);
    expect(templateRateFor("+573001234567", "RARA")).toBe(0.0125);
  });

  test("el precio a mano manda si no es 0", () => {
    const flat = { currency: "USD", MARKETING: 0.05, UTILITY: 0 };
    expect(templateRateFor("+573001234567", "MARKETING", flat)).toBe(0.05);
    // UTILITY sin poner: la tabla, no 0.
    expect(templateRateFor("+573001234567", "UTILITY", flat)).toBe(0.0008);
    expect(templateRateFor("+573001234567", "MARKETING", { currency: "USD", MARKETING: 0, UTILITY: 0 })).toBe(0.0125);
  });
});

describe("estimateTemplateCost", () => {
  test("suma la tarifa de cada país y desglosa por grupo", () => {
    const phones = [
      ...Array.from({ length: 200 }, () => "+573001234567"),
      ...Array.from({ length: 20 }, () => "+5215512345678"),
      "+34612345678",
      "+13055551234",
      "+18095551234",
      "+79161234567",
    ];
    const e = estimateTemplateCost(phones, "MARKETING");
    // 200·0.0125 + 20·0.0436 + 0.0615 + 2·0.025 + 0.0604
    expect(e.total).toBeCloseTo(2.5 + 0.872 + 0.0615 + 0.05 + 0.0604, 4);
    expect(e.source).toBe("rates");
    expect(e.currency).toBe("USD");
    expect(e.groups.find((g) => g.key === "co")).toEqual({ key: "co", label: "Colombia", count: 200, subtotal: 2.5 });
    expect(e.groups.find((g) => g.key === "na")).toMatchObject({ count: 2, subtotal: 0.05 });
    expect(e.groups.reduce((n, g) => n + g.count, 0)).toBe(phones.length);
    // Del que más cuesta al que menos.
    expect(e.groups[0].key).toBe("co");
  });

  test("utility es más barata", () => {
    expect(estimateTemplateCost(["+573001234567", "+573001234568"], "UTILITY").total).toBe(0.0016);
  });

  test("nadie con plantilla: 0", () => {
    expect(estimateTemplateCost([], "MARKETING")).toEqual({ total: 0, currency: "USD", source: "rates", groups: [] });
  });

  test("con precio a mano: plano, con su moneda", () => {
    const e = estimateTemplateCost(["+573001234567", "+5215512345678"], "MARKETING", {
      currency: "COP",
      MARKETING: 50,
      UTILITY: 0,
    });
    expect(e).toMatchObject({ total: 100, currency: "COP", source: "manual" });
    expect(e.groups.map((g) => g.subtotal)).toEqual([50, 50]);
  });
});
