import { describe, expect, test } from "bun:test";

import {
  aggregateAnswerDistribution,
  averageTickets,
  buildSeriesByCurrency,
  buildUsdEquivalentSeries,
  countryLabel,
  mergeBreakdownInputs,
  mergeMoneyKpis,
  totalsByCurrency,
} from "./sales-helpers";

describe("aggregateAnswerDistribution", () => {
  test("cuenta respuestas de una opción, en orden del cuestionario y con opciones a 0", () => {
    const result = aggregateAnswerDistribution([
      { orientacion: "pesa", tiempo: "anios" },
      { orientacion: "pesa", tiempo: "meses" },
      { orientacion: "avanzar", tiempo: "anios" },
    ]);

    expect(result.map((q) => q.questionId)).toEqual([
      "orientacion",
      "foco-emocional",
      "foco-crecimiento",
      "tiempo",
      "modalidad",
      "cierre",
    ]);

    const orientacion = result[0];
    expect(orientacion.question).toBe("¿Qué te trae hoy aquí?");
    expect(orientacion.options).toEqual([
      { key: "pesa", label: "Algo me pesa y quiero soltarlo", value: 2, share: 0.6667 },
      { key: "avanzar", label: "Quiero crecer y dar el siguiente paso", value: 1, share: 0.3333 },
    ]);

    const tiempo = result.find((q) => q.questionId === "tiempo");
    // Orden del cuestionario, no por frecuencia; «semanas» y «siempre» salen a 0.
    expect(tiempo?.options.map((o) => [o.key, o.value, o.share])).toEqual([
      ["semanas", 0, 0],
      ["meses", 1, 0.3333],
      ["anios", 2, 0.6667],
      ["siempre", 0, 0],
    ]);
  });

  test("preguntas sin respuestas: opciones a 0 y share null", () => {
    const result = aggregateAnswerDistribution([{ orientacion: "pesa" }]);
    const modalidad = result.find((q) => q.questionId === "modalidad");
    expect(modalidad?.options.every((o) => o.value === 0 && o.share === null)).toBe(true);
  });

  test("ignora preguntas y opciones retiradas y basura", () => {
    const result = aggregateAnswerDistribution([
      // Diagnóstico antiguo: `dolor`, `freno` y `manifestacion` ya no existen.
      { dolor: "ansiedad", freno: "dinero", manifestacion: ["cuerpo"], tiempo: "anios" },
      { orientacion: "opcion-retirada", tiempo: "anios" },
      null,
      "texto",
      42,
    ]);
    const orientacion = result.find((q) => q.questionId === "orientacion");
    expect(orientacion?.options.map((o) => o.value)).toEqual([0, 0]);
    expect(orientacion?.options[0].share).toBeNull();

    const tiempo = result.find((q) => q.questionId === "tiempo");
    expect(tiempo?.options.find((o) => o.key === "anios")).toMatchObject({ value: 2, share: 1 });
  });

  test("lista vacía", () => {
    const result = aggregateAnswerDistribution([]);
    expect(result).toHaveLength(6);
    expect(result.flatMap((q) => q.options).every((o) => o.value === 0)).toBe(true);
  });
});

describe("mergeMoneyKpis", () => {
  test("incluye monedas presentes solo en uno de los periodos, ordenadas", () => {
    const kpis = mergeMoneyKpis({ USD: 15_000, COP: 400_000 }, { COP: 200_000, EUR: 1_000 });
    expect(kpis.map((k) => k.currency)).toEqual(["COP", "EUR", "USD"]);
    expect(kpis[0].kpi).toEqual({ value: 400_000, previous: 200_000, delta: 1, trend: "up" });
    expect(kpis[1].kpi).toEqual({ value: 0, previous: 1_000, delta: -1, trend: "down" });
    expect(kpis[2].kpi).toEqual({ value: 15_000, previous: 0, delta: null, trend: "up" });
  });

  test("sin datos en ningún periodo", () => {
    expect(mergeMoneyKpis({}, {})).toEqual([]);
  });
});

describe("totalsByCurrency y averageTickets", () => {
  test("suma por moneda y ticket promedio con null sin pagos", () => {
    const revenue = totalsByCurrency([
      { currency: "COP", value: 100_000 },
      { currency: "COP", value: 50_001 },
      { currency: "USD", value: 0 },
    ]);
    expect(revenue).toEqual({ COP: 150_001, USD: 0 });
    expect(averageTickets(["COP", "USD"], revenue, { COP: 2 })).toEqual([
      { currency: "COP", valueMinor: 75_001 },
      { currency: "USD", valueMinor: null },
    ]);
  });
});

describe("series", () => {
  const keys = ["2026-09-07", "2026-09-14"];

  test("una serie continua por moneda, agrupada por semana", () => {
    const series = buildSeriesByCurrency(
      [
        { dateKey: "2026-09-08", currency: "USD", value: 1_000 },
        { dateKey: "2026-09-09", currency: "USD", value: 500 },
        { dateKey: "2026-09-14", currency: "COP", value: 350_000 },
      ],
      keys,
      "week",
    );
    expect(series).toEqual([
      { currency: "COP", points: [{ key: "2026-09-07", value: 0 }, { key: "2026-09-14", value: 350_000 }] },
      { currency: "USD", points: [{ key: "2026-09-07", value: 1_500 }, { key: "2026-09-14", value: 0 }] },
    ]);
  });

  test("equivalente USD suma monedas convertidas y omite las no soportadas", () => {
    const points = buildUsdEquivalentSeries(
      [
        { currency: "COP", points: [{ key: "2026-09-07", value: 10_000 }, { key: "2026-09-14", value: 0 }] },
        { currency: "USD", points: [{ key: "2026-09-07", value: 1_234 }, { key: "2026-09-14", value: 100 }] },
        { currency: "EUR", points: [{ key: "2026-09-07", value: 99_999 }] },
      ],
      keys,
      3_000,
    );
    // 10.000 COP / 3.000 = 3,33 USD + 12,34 USD
    expect(points).toEqual([
      { key: "2026-09-07", value: 15.67 },
      { key: "2026-09-14", value: 1 },
    ]);
  });

  test("sin series devuelve ceros en todas las cubetas", () => {
    expect(buildUsdEquivalentSeries([], keys, 4_000)).toEqual([
      { key: "2026-09-07", value: 0 },
      { key: "2026-09-14", value: 0 },
    ]);
  });
});

describe("mergeBreakdownInputs y countryLabel", () => {
  test("junta filas con la misma clave y moneda, sin mezclar monedas", () => {
    const merged = mergeBreakdownInputs([
      { key: "PAYPAL:USD", label: "PayPal", value: 100, currency: "USD" },
      { key: "PAYPAL:USD", label: "PayPal", value: 50, currency: "USD" },
      { key: "PAYPAL:COP", label: "PayPal", value: 7, currency: "COP" },
    ]);
    expect(merged).toEqual([
      { key: "PAYPAL:USD", label: "PayPal", value: 150, currency: "USD" },
      { key: "PAYPAL:COP", label: "PayPal", value: 7, currency: "COP" },
    ]);
  });

  test("etiqueta de país", () => {
    expect(countryLabel(null)).toBe("Sin país");
    expect(countryLabel("co")).toBe("Colombia");
  });
});
