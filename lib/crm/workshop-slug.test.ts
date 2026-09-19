import { describe, expect, test } from "bun:test";

import { isValidWorkshopSlug, normalizeWorkshopSlug } from "./workshop-slug";

describe("isValidWorkshopSlug", () => {
  test("acepta minúsculas, números y guiones", () => {
    expect(isValidWorkshopSlug("de-frustracion-a-ganador-en-ventas")).toBe(true);
    expect(isValidWorkshopSlug("taller-2026")).toBe(true);
  });

  test("rechaza mayúsculas, tildes, espacios y bordes con guion", () => {
    expect(isValidWorkshopSlug("Taller")).toBe(false);
    expect(isValidWorkshopSlug("frustración")).toBe(false);
    expect(isValidWorkshopSlug("mi taller")).toBe(false);
    expect(isValidWorkshopSlug("-taller")).toBe(false);
    expect(isValidWorkshopSlug("taller-")).toBe(false);
    expect(isValidWorkshopSlug("taller--doble")).toBe(false);
    expect(isValidWorkshopSlug("ab")).toBe(false);
    expect(isValidWorkshopSlug("../secreto")).toBe(false);
  });
});

describe("normalizeWorkshopSlug", () => {
  test("convierte un título en URL", () => {
    expect(normalizeWorkshopSlug("  De Frustración a Ganador en Ventas! ")).toBe(
      "de-frustracion-a-ganador-en-ventas",
    );
  });

  test("resultado normalizado siempre es válido si tiene largo suficiente", () => {
    expect(isValidWorkshopSlug(normalizeWorkshopSlug("Reconstrúyete 2.0"))).toBe(true);
  });
});
