import { describe, expect, test } from "bun:test";

import {
  courseEntryId,
  courseStartId,
  moduleItemIds,
  moduleStartId,
  readingId,
} from "./course-sequence";

// Forma de `fundamentos-pnl`: cada módulo abre con su Introducción y su
// primera lección es la «Presentación».
const m1 = {
  id: "m1",
  bodyMd: "**Programación Neurolingüística.** Tres palabras…",
  classes: [{ id: "m1-presentacion" }, { id: "m1-origen" }],
};
const m2 = {
  id: "m2",
  bodyMd: "Nadie percibe la realidad.",
  classes: [{ id: "m2-presentacion" }, { id: "m2-filtros" }],
};
const course = [m1, m2];

describe("moduleItemIds", () => {
  test("la Introducción va antes que las lecciones, como en el temario", () => {
    expect(moduleItemIds(m1)).toEqual(["reading:m1", "m1-presentacion", "m1-origen"]);
  });

  test("un módulo sin texto (o solo espacios) no tiene Introducción", () => {
    expect(moduleItemIds({ ...m1, bodyMd: null })).toEqual(["m1-presentacion", "m1-origen"]);
    expect(moduleItemIds({ ...m1, bodyMd: "  \n " })).toEqual(["m1-presentacion", "m1-origen"]);
  });
});

describe("moduleStartId", () => {
  test("abrir un módulo entra por su Introducción", () => {
    expect(moduleStartId(m2)).toBe(readingId("m2"));
  });

  test("sin Introducción, por su primera lección", () => {
    expect(moduleStartId({ ...m2, bodyMd: null })).toBe("m2-presentacion");
  });

  test("un módulo vacío no tiene por dónde entrar", () => {
    expect(moduleStartId({ id: "m3", bodyMd: null, classes: [] })).toBeNull();
  });
});

describe("courseStartId", () => {
  test("el curso empieza por la Introducción del módulo 1", () => {
    expect(courseStartId(course)).toBe("reading:m1");
  });

  test("si el módulo 1 no tiene texto, por su primera lección", () => {
    expect(courseStartId([{ ...m1, bodyMd: null }, m2])).toBe("m1-presentacion");
  });

  test("se salta los módulos vacíos del principio", () => {
    expect(courseStartId([{ id: "m0", bodyMd: null, classes: [] }, m1])).toBe("reading:m1");
  });

  test("curso sin contenido", () => {
    expect(courseStartId([])).toBeNull();
  });
});

describe("courseEntryId (URL sin ?c=)", () => {
  test("«Empezar»: sin nada completado abre por el principio, no por la primera lección", () => {
    // Antes devolvía `nextIncompleteClassId` = «Presentación», la segunda
    // fila del temario.
    expect(
      courseEntryId(course, { completedClasses: 0, nextIncompleteClassId: "m1-presentacion" })
    ).toBe("reading:m1");
  });

  test("«Continuar»: con progreso, la siguiente lección sin completar", () => {
    expect(
      courseEntryId(course, { completedClasses: 2, nextIncompleteClassId: "m2-presentacion" })
    ).toBe("m2-presentacion");
  });

  test("«Repasar»: con todo completado, otra vez por el principio", () => {
    expect(courseEntryId(course, { completedClasses: 4, nextIncompleteClassId: null })).toBe(
      "reading:m1"
    );
  });
});
