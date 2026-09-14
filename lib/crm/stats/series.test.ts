import { describe, expect, test } from "bun:test";

import { fillSeries, sumByBucket } from "./series";

describe("fillSeries", () => {
  const keys = ["2026-09-12", "2026-09-13", "2026-09-14"];

  test("un punto por clave, en orden, faltantes en 0", () => {
    expect(fillSeries(keys, [{ key: "2026-09-14", value: 3 }])).toEqual([
      { key: "2026-09-12", value: 0 },
      { key: "2026-09-13", value: 0 },
      { key: "2026-09-14", value: 3 },
    ]);
  });

  test("sin filas → todo en 0", () => {
    expect(fillSeries(keys, []).map((p) => p.value)).toEqual([0, 0, 0]);
  });

  test("filas fuera del rango se ignoran", () => {
    expect(
      fillSeries(keys, [
        { key: "2026-09-11", value: 9 },
        { key: "2026-09-13", value: 2 },
        { key: "2026-09-15", value: 9 },
      ])
    ).toEqual([
      { key: "2026-09-12", value: 0 },
      { key: "2026-09-13", value: 2 },
      { key: "2026-09-14", value: 0 },
    ]);
  });

  test("claves duplicadas se suman", () => {
    expect(
      fillSeries(keys, [
        { key: "2026-09-12", value: 1 },
        { key: "2026-09-12", value: 4 },
      ])[0]
    ).toEqual({ key: "2026-09-12", value: 5 });
  });

  test("el orden de las filas no importa", () => {
    const out = fillSeries(keys, [
      { key: "2026-09-14", value: 1 },
      { key: "2026-09-12", value: 2 },
    ]);
    expect(out.map((p) => p.key)).toEqual(keys);
  });

  test("sin claves → vacío", () => {
    expect(fillSeries([], [{ key: "x", value: 1 }])).toEqual([]);
  });
});

describe("sumByBucket", () => {
  const rows = [
    { dateKey: "2026-09-13", value: 1 }, // domingo → semana del 07
    { dateKey: "2026-09-14", value: 2 }, // lunes → semana del 14
    { dateKey: "2026-09-20", value: 3 }, // domingo → semana del 14
    { dateKey: "2026-08-31", value: 4 }, // lunes → semana del 31/08
    { dateKey: "2026-09-01", value: 5 },
  ];

  test("día: agrupa repetidos y ordena", () => {
    expect(
      sumByBucket(
        [
          { dateKey: "2026-09-02", value: 1 },
          { dateKey: "2026-09-01", value: 2 },
          { dateKey: "2026-09-02", value: 3 },
        ],
        "day"
      )
    ).toEqual([
      { key: "2026-09-01", value: 2 },
      { key: "2026-09-02", value: 4 },
    ]);
  });

  test("semana ISO", () => {
    expect(sumByBucket(rows, "week")).toEqual([
      { key: "2026-08-31", value: 9 },
      { key: "2026-09-07", value: 1 },
      { key: "2026-09-14", value: 5 },
    ]);
  });

  test("semana cruzando el año", () => {
    expect(
      sumByBucket(
        [
          { dateKey: "2025-12-31", value: 1 },
          { dateKey: "2026-01-04", value: 2 },
          { dateKey: "2026-01-05", value: 3 },
        ],
        "week"
      )
    ).toEqual([
      { key: "2025-12-29", value: 3 },
      { key: "2026-01-05", value: 3 },
    ]);
  });

  test("mes", () => {
    expect(sumByBucket(rows, "month")).toEqual([
      { key: "2026-08", value: 4 },
      { key: "2026-09", value: 11 },
    ]);
  });

  test("encaja con fillSeries", () => {
    const filled = fillSeries(["2026-08", "2026-09", "2026-10"], sumByBucket(rows, "month"));
    expect(filled).toEqual([
      { key: "2026-08", value: 4 },
      { key: "2026-09", value: 11 },
      { key: "2026-10", value: 0 },
    ]);
  });
});
