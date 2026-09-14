import { describe, expect, test } from "bun:test";

import { getDateKeyInTz, getTimeHmInTz } from "@/lib/datetime/zoned-time";

import {
  bucketKeyForDateKey,
  bucketKeys,
  DEFAULT_STATS_AREA,
  DEFAULT_STATS_PERIOD,
  parseStatsArea,
  parseStatsRange,
  STATS_AREAS,
  STATS_PERIODS,
  statsRangeToSearchParams,
} from "./range";
import type { StatsRange } from "./types";

/**
 * Bogotá es UTC−5 sin DST: la medianoche local es 05:00Z. Madrid cambia de
 * hora el 2026-03-29 (día de 23 h) y el 2026-10-25 (día de 25 h).
 */
const BOG = "America/Bogota";
const MAD = "Europe/Madrid";
/** 15:00 del 14 de septiembre en Bogotá. */
const NOW_AFTERNOON = new Date("2026-09-14T20:00:00Z");
/** 22:30 del 14 de septiembre en Bogotá (ya es 15 en UTC). */
const NOW_LATE = new Date("2026-09-15T03:30:00Z");
const HOUR = 60 * 60 * 1000;

const iso = (d: Date) => d.toISOString();

describe("constantes", () => {
  test("periodos y áreas", () => {
    expect(STATS_PERIODS).toEqual(["7d", "30d", "90d", "12mo", "custom"]);
    expect(DEFAULT_STATS_PERIOD).toBe("30d");
    expect(STATS_AREAS).toEqual(["ventas", "embudo", "contactos", "contenido"]);
    expect(DEFAULT_STATS_AREA).toBe("ventas");
  });
});

describe("parseStatsArea", () => {
  test("acepta áreas conocidas", () => {
    for (const area of STATS_AREAS) expect(parseStatsArea(area)).toBe(area);
  });
  test("desconocido, vacío o ausente → ventas", () => {
    expect(parseStatsArea("pagos")).toBe("ventas");
    expect(parseStatsArea("")).toBe("ventas");
    expect(parseStatsArea(undefined)).toBe("ventas");
    expect(parseStatsArea("VENTAS")).toBe("ventas");
  });
  test("array → primer valor", () => {
    expect(parseStatsArea(["embudo", "contenido"])).toBe("embudo");
    expect(parseStatsArea([])).toBe("ventas");
  });
});

describe("parseStatsRange — presets en Bogotá", () => {
  for (const now of [NOW_AFTERNOON, NOW_LATE]) {
    describe(`now = ${iso(now)}`, () => {
      test("7d incluye hoy y los 6 días anteriores", () => {
        const r = parseStatsRange({ period: "7d" }, BOG, now);
        expect(r.period).toBe("7d");
        expect(r.timeZone).toBe(BOG);
        expect(r.fromKey).toBe("2026-09-08");
        expect(r.toKey).toBe("2026-09-14");
        expect(r.days).toBe(7);
        expect(iso(r.from)).toBe("2026-09-08T05:00:00.000Z");
        expect(iso(r.to)).toBe("2026-09-15T05:00:00.000Z");
        expect(iso(r.prevFrom)).toBe("2026-09-01T05:00:00.000Z");
        expect(iso(r.prevTo)).toBe("2026-09-08T05:00:00.000Z");
        expect(r.granularity).toBe("day");
      });

      test("30d", () => {
        const r = parseStatsRange({ period: "30d" }, BOG, now);
        expect(r.fromKey).toBe("2026-08-16");
        expect(r.toKey).toBe("2026-09-14");
        expect(r.days).toBe(30);
        expect(iso(r.from)).toBe("2026-08-16T05:00:00.000Z");
        expect(iso(r.to)).toBe("2026-09-15T05:00:00.000Z");
        expect(iso(r.prevFrom)).toBe("2026-07-17T05:00:00.000Z");
        expect(r.granularity).toBe("day");
      });

      test("90d", () => {
        const r = parseStatsRange({ period: "90d" }, BOG, now);
        expect(r.fromKey).toBe("2026-06-17");
        expect(r.days).toBe(90);
        expect(iso(r.from)).toBe("2026-06-17T05:00:00.000Z");
        expect(iso(r.prevFrom)).toBe("2026-03-19T05:00:00.000Z");
        expect(r.granularity).toBe("week");
      });

      test("12mo = últimos 365 días locales", () => {
        const r = parseStatsRange({ period: "12mo" }, BOG, now);
        expect(r.fromKey).toBe("2025-09-15");
        expect(r.toKey).toBe("2026-09-14");
        expect(r.days).toBe(365);
        expect(iso(r.from)).toBe("2025-09-15T05:00:00.000Z");
        expect(iso(r.prevFrom)).toBe("2024-09-15T05:00:00.000Z");
        expect(r.granularity).toBe("month");
      });
    });
  }

  test("sin period, desconocido o array → 30d", () => {
    expect(parseStatsRange({}, BOG, NOW_AFTERNOON).period).toBe("30d");
    expect(parseStatsRange({ period: "1y" }, BOG, NOW_AFTERNOON).period).toBe("30d");
    expect(parseStatsRange({ period: ["7d", "90d"] }, BOG, NOW_AFTERNOON).period).toBe("7d");
  });

  test("periodo anterior: misma longitud e inmediatamente antes", () => {
    for (const period of ["7d", "30d", "90d", "12mo"]) {
      const r = parseStatsRange({ period }, BOG, NOW_AFTERNOON);
      expect(r.prevTo.getTime()).toBe(r.from.getTime());
      // Bogotá no tiene DST: todos los días duran 24 h.
      expect(r.to.getTime() - r.from.getTime()).toBe(r.days * 24 * HOUR);
      expect(r.prevTo.getTime() - r.prevFrom.getTime()).toBe(r.days * 24 * HOUR);
    }
  });

  test("un pago a las 20:00Z (15:00 Bogotá) cae dentro del día de hoy", () => {
    const r = parseStatsRange({ period: "7d" }, BOG, NOW_LATE);
    const paidAt = new Date("2026-09-14T20:00:00Z").getTime();
    expect(paidAt >= r.from.getTime() && paidAt < r.to.getTime()).toBe(true);
    const tomorrowEarly = new Date("2026-09-15T05:00:00Z").getTime();
    expect(tomorrowEarly < r.to.getTime()).toBe(false);
  });
});

describe("parseStatsRange — zona horaria", () => {
  test("zona inválida o vacía → America/Bogota", () => {
    for (const tz of ["Mars/Olympus", "", "not a zone"]) {
      const r = parseStatsRange({ period: "7d" }, tz, NOW_AFTERNOON);
      expect(r.timeZone).toBe(BOG);
      expect(iso(r.from)).toBe("2026-09-08T05:00:00.000Z");
    }
  });

  test("hoy depende de la zona: 03:30Z ya es día 15 en Madrid", () => {
    const r = parseStatsRange({ period: "7d" }, MAD, NOW_LATE);
    expect(r.toKey).toBe("2026-09-15");
    expect(iso(r.to)).toBe("2026-09-15T22:00:00.000Z");
  });
});

describe("parseStatsRange — DST (Europe/Madrid)", () => {
  const now = new Date("2026-11-01T12:00:00Z");

  test("día de 25 h (fin de horario de verano, 2026-10-25)", () => {
    const r = parseStatsRange({ period: "custom", from: "2026-10-25", to: "2026-10-25" }, MAD, now);
    expect(r.days).toBe(1);
    expect(iso(r.from)).toBe("2026-10-24T22:00:00.000Z");
    expect(iso(r.to)).toBe("2026-10-25T23:00:00.000Z");
    expect(r.to.getTime() - r.from.getTime()).toBe(25 * HOUR);
    // Periodo anterior: el 24 de octubre, día normal de 24 h.
    expect(iso(r.prevFrom)).toBe("2026-10-23T22:00:00.000Z");
    expect(iso(r.prevTo)).toBe("2026-10-24T22:00:00.000Z");
  });

  test("rango que cruza el cambio: bordes en medianoches locales", () => {
    const r = parseStatsRange({ period: "custom", from: "2026-10-24", to: "2026-10-26" }, MAD, now);
    expect(r.days).toBe(3);
    expect(iso(r.from)).toBe("2026-10-23T22:00:00.000Z");
    expect(iso(r.to)).toBe("2026-10-26T23:00:00.000Z");
    expect(r.to.getTime() - r.from.getTime()).toBe(73 * HOUR);
    for (const instant of [r.from, r.to, r.prevFrom, r.prevTo]) {
      expect(getTimeHmInTz(instant, MAD)).toBe("00:00");
    }
    expect(getDateKeyInTz(r.from, MAD)).toBe("2026-10-24");
    expect(getDateKeyInTz(r.to, MAD)).toBe("2026-10-27");
    expect(getDateKeyInTz(r.prevFrom, MAD)).toBe("2026-10-21");
    expect(bucketKeys(r)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
  });

  test("día siguiente al cambio empieza a las 23:00Z", () => {
    const r = parseStatsRange({ period: "custom", from: "2026-10-26", to: "2026-10-26" }, MAD, now);
    expect(iso(r.from)).toBe("2026-10-25T23:00:00.000Z");
    expect(iso(r.to)).toBe("2026-10-26T23:00:00.000Z");
    expect(iso(r.prevFrom)).toBe("2026-10-24T22:00:00.000Z");
  });

  test("día de 23 h (inicio de horario de verano, 2026-03-29)", () => {
    const r = parseStatsRange({ period: "custom", from: "2026-03-29", to: "2026-03-29" }, MAD, now);
    expect(iso(r.from)).toBe("2026-03-28T23:00:00.000Z");
    expect(iso(r.to)).toBe("2026-03-29T22:00:00.000Z");
    expect(r.to.getTime() - r.from.getTime()).toBe(23 * HOUR);
  });

  test("preset 7d con el cambio dentro: 7 días locales = 169 h", () => {
    const r = parseStatsRange({ period: "7d" }, MAD, new Date("2026-10-28T10:00:00Z"));
    expect(r.fromKey).toBe("2026-10-22");
    expect(r.toKey).toBe("2026-10-28");
    expect(r.to.getTime() - r.from.getTime()).toBe(169 * HOUR);
    expect(getTimeHmInTz(r.from, MAD)).toBe("00:00");
    expect(getTimeHmInTz(r.to, MAD)).toBe("00:00");
  });

  test("medianoche inexistente (America/Santiago, 2026-09-06): primer instante del día", () => {
    const r = parseStatsRange(
      { period: "custom", from: "2026-09-06", to: "2026-09-06" },
      "America/Santiago",
      now
    );
    expect(getDateKeyInTz(r.from, "America/Santiago")).toBe("2026-09-06");
    expect(getDateKeyInTz(new Date(r.from.getTime() - 1000), "America/Santiago")).toBe(
      "2026-09-05"
    );
    expect(r.to.getTime() - r.from.getTime()).toBe(23 * HOUR);
  });
});

describe("parseStatsRange — custom", () => {
  const custom = (from?: string | string[], to?: string | string[]) =>
    parseStatsRange({ period: "custom", from, to }, BOG, NOW_AFTERNOON);

  test("rango válido inclusivo", () => {
    const r = custom("2026-09-01", "2026-09-10");
    expect(r.period).toBe("custom");
    expect(r.fromKey).toBe("2026-09-01");
    expect(r.toKey).toBe("2026-09-10");
    expect(r.days).toBe(10);
    expect(iso(r.from)).toBe("2026-09-01T05:00:00.000Z");
    expect(iso(r.to)).toBe("2026-09-11T05:00:00.000Z");
    expect(iso(r.prevFrom)).toBe("2026-08-22T05:00:00.000Z");
    expect(iso(r.prevTo)).toBe("2026-09-01T05:00:00.000Z");
  });

  test("un solo día", () => {
    const r = custom("2026-09-14", "2026-09-14");
    expect(r.days).toBe(1);
    expect(iso(r.prevFrom)).toBe("2026-09-13T05:00:00.000Z");
  });

  test("invertido → se intercambia", () => {
    const r = custom("2026-09-10", "2026-09-01");
    expect(r.fromKey).toBe("2026-09-01");
    expect(r.toKey).toBe("2026-09-10");
  });

  test("to en el futuro → se recorta a hoy", () => {
    const r = custom("2026-09-10", "2026-12-31");
    expect(r.toKey).toBe("2026-09-14");
    expect(r.days).toBe(5);
  });

  test("ambos en el futuro → solo hoy", () => {
    const r = custom("2027-01-01", "2027-02-01");
    expect(r.fromKey).toBe("2026-09-14");
    expect(r.toKey).toBe("2026-09-14");
    expect(r.days).toBe(1);
  });

  test("366 días se permiten; más se recorta desde el inicio", () => {
    const ok = custom("2025-09-14", "2026-09-14");
    expect(ok.days).toBe(366);
    expect(ok.fromKey).toBe("2025-09-14");

    const long = custom("2020-01-01", "2026-06-30");
    expect(long.days).toBe(366);
    expect(long.toKey).toBe("2026-06-30");
    expect(long.fromKey).toBe("2025-06-30");
  });

  test("valores inválidos o ausentes → preset por defecto", () => {
    const cases: [string | undefined, string | undefined][] = [
      [undefined, undefined],
      ["2026-09-01", undefined],
      [undefined, "2026-09-10"],
      ["2026-02-30", "2026-03-10"],
      ["2026-13-01", "2026-09-10"],
      ["01/09/2026", "2026-09-10"],
      ["2026-9-1", "2026-09-10"],
      ["", ""],
      ["2026-09-01T00:00", "2026-09-10"],
    ];
    for (const [from, to] of cases) {
      const r = custom(from, to);
      expect(r.period).toBe("30d");
      expect(r.fromKey).toBe("2026-08-16");
      expect(r.toKey).toBe("2026-09-14");
    }
  });

  test("29 de febrero real se acepta", () => {
    const r = parseStatsRange(
      { period: "custom", from: "2028-02-28", to: "2028-03-01" },
      BOG,
      new Date("2028-06-01T12:00:00Z")
    );
    expect(r.days).toBe(3);
  });

  test("arrays → primer valor", () => {
    const r = parseStatsRange(
      { period: ["custom"], from: ["2026-09-01", "2026-01-01"], to: ["2026-09-03"] },
      BOG,
      NOW_AFTERNOON
    );
    expect(r.fromKey).toBe("2026-09-01");
    expect(r.toKey).toBe("2026-09-03");
  });
});

describe("granularidad", () => {
  const withDays = (fromKey: string) =>
    parseStatsRange({ period: "custom", from: fromKey, to: "2026-09-14" }, BOG, NOW_AFTERNOON);

  test("umbrales 45/46/180/181", () => {
    const d45 = withDays("2026-08-01");
    expect(d45.days).toBe(45);
    expect(d45.granularity).toBe("day");

    const d46 = withDays("2026-07-31");
    expect(d46.days).toBe(46);
    expect(d46.granularity).toBe("week");

    const d180 = withDays("2026-03-19");
    expect(d180.days).toBe(180);
    expect(d180.granularity).toBe("week");

    const d181 = withDays("2026-03-18");
    expect(d181.days).toBe(181);
    expect(d181.granularity).toBe("month");
  });
});

/** Rango sintético para probar cubetas con cualquier granularidad. */
const fakeRange = (
  fromKey: string,
  toKey: string,
  granularity: StatsRange["granularity"]
): StatsRange => ({
  period: "custom",
  timeZone: BOG,
  from: new Date(0),
  to: new Date(0),
  prevFrom: new Date(0),
  prevTo: new Date(0),
  fromKey,
  toKey,
  granularity,
  days: 0,
});

describe("bucketKeys", () => {
  test("día: cada fecha local, cruzando meses", () => {
    expect(bucketKeys(fakeRange("2026-08-30", "2026-09-02", "day"))).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
  });

  test("7d real produce 7 claves", () => {
    const r = parseStatsRange({ period: "7d" }, BOG, NOW_AFTERNOON);
    expect(bucketKeys(r)).toHaveLength(7);
  });

  test("semana: primer lunes en o antes de fromKey", () => {
    // 2026-09-02 es miércoles; 2026-09-14 es lunes.
    expect(bucketKeys(fakeRange("2026-09-02", "2026-09-14", "week"))).toEqual([
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
    ]);
  });

  test("semana: fromKey lunes y toKey domingo", () => {
    expect(bucketKeys(fakeRange("2026-09-07", "2026-09-20", "week"))).toEqual([
      "2026-09-07",
      "2026-09-14",
    ]);
  });

  test("semana: cruce de año", () => {
    // 2025-12-25 jueves → lunes 2025-12-22; 2026-01-05 es lunes.
    expect(bucketKeys(fakeRange("2025-12-25", "2026-01-06", "week"))).toEqual([
      "2025-12-22",
      "2025-12-29",
      "2026-01-05",
    ]);
  });

  test("semana: 90d real cubre todos los días", () => {
    const r = parseStatsRange({ period: "90d" }, BOG, NOW_AFTERNOON);
    const keys = bucketKeys(r);
    expect(keys[0] <= r.fromKey).toBe(true);
    expect(keys[keys.length - 1] <= r.toKey).toBe(true);
    expect(keys).toHaveLength(14);
  });

  test("mes: cruce de año (12mo)", () => {
    const r = parseStatsRange({ period: "12mo" }, BOG, NOW_AFTERNOON);
    expect(bucketKeys(r)).toEqual([
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
  });

  test("mes: mismo mes → una clave", () => {
    expect(bucketKeys(fakeRange("2026-09-01", "2026-09-30", "month"))).toEqual(["2026-09"]);
  });
});

describe("bucketKeyForDateKey", () => {
  test("día", () => {
    expect(bucketKeyForDateKey("2026-09-14", "day")).toBe("2026-09-14");
  });
  test("semana ISO (lunes)", () => {
    expect(bucketKeyForDateKey("2026-09-14", "week")).toBe("2026-09-14"); // lunes
    expect(bucketKeyForDateKey("2026-09-20", "week")).toBe("2026-09-14"); // domingo
    expect(bucketKeyForDateKey("2026-09-13", "week")).toBe("2026-09-07"); // domingo anterior
    expect(bucketKeyForDateKey("2026-01-01", "week")).toBe("2025-12-29"); // jueves
    expect(bucketKeyForDateKey("2027-01-01", "week")).toBe("2026-12-28"); // viernes
  });
  test("mes", () => {
    expect(bucketKeyForDateKey("2026-02-28", "month")).toBe("2026-02");
  });
  test("clave inválida lanza", () => {
    expect(() => bucketKeyForDateKey("2026-02-30", "day")).toThrow();
    expect(() => bucketKeyForDateKey("14/09/2026", "month")).toThrow();
  });
  test("coincide con bucketKeys para cada día del rango", () => {
    const r = parseStatsRange({ period: "90d" }, BOG, NOW_AFTERNOON);
    const weekKeys = new Set(bucketKeys(r));
    for (const day of bucketKeys({ ...r, granularity: "day" })) {
      expect(weekKeys.has(bucketKeyForDateKey(day, "week"))).toBe(true);
    }
  });
});

describe("statsRangeToSearchParams", () => {
  test("preset solo lleva period", () => {
    const r = parseStatsRange({ period: "90d" }, BOG, NOW_AFTERNOON);
    expect(statsRangeToSearchParams(r)).toEqual({ period: "90d" });
  });
  test("custom lleva from/to", () => {
    const r = parseStatsRange(
      { period: "custom", from: "2026-09-01", to: "2026-09-10" },
      BOG,
      NOW_AFTERNOON
    );
    expect(statsRangeToSearchParams(r)).toEqual({
      period: "custom",
      from: "2026-09-01",
      to: "2026-09-10",
    });
  });
  test("ida y vuelta", () => {
    const r = parseStatsRange(
      { period: "custom", from: "2026-08-01", to: "2026-08-31" },
      BOG,
      NOW_AFTERNOON
    );
    const again = parseStatsRange(statsRangeToSearchParams(r), BOG, NOW_AFTERNOON);
    expect(again).toEqual(r);
  });
});
