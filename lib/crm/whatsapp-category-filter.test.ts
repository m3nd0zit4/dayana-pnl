import { describe, expect, test } from "bun:test";
import { CHAT_CATEGORIES } from "./chat-category-rules";
import type { CategoryCounts } from "./chat-category";
import {
  CATEGORY_FILTERS,
  categoryCountOf,
  chatCategoryWhere,
  isChatCategoryFilter,
  showCategoryFilter,
} from "./whatsapp-category-filter";

describe("filtro de categoría de «Todos»", () => {
  test("acepta las categorías, «sin clasificar» y «revisar»; nada más", () => {
    for (const c of CHAT_CATEGORIES) expect(isChatCategoryFilter(c)).toBe(true);
    expect(isChatCategoryFilter("unclassified")).toBe(true);
    expect(isChatCategoryFilter("review")).toBe(true);
    for (const v of ["", "Cliente", "clientes", "todas", null, undefined, 3]) expect(isChatCategoryFilter(v)).toBe(false);
  });

  test("sin filtro no restringe nada", () => {
    expect(chatCategoryWhere(null)).toEqual({});
    expect(chatCategoryWhere(undefined)).toEqual({});
  });

  test("una categoría es esa categoría (también «otro»)", () => {
    expect(chatCategoryWhere("negocio")).toEqual({ category: "negocio" });
    expect(chatCategoryWhere("otro")).toEqual({ category: "otro" });
  });

  test("hay un chip por categoría, más «sin clasificar» y «revisar», sin repetir", () => {
    const ids: string[] = CATEGORY_FILTERS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...CHAT_CATEGORIES, "unclassified", "review"].sort());
    expect(CATEGORY_FILTERS.find((f) => f.id === "otro")?.label).toBe("Otros");
    for (const id of ids) expect(isChatCategoryFilter(id)).toBe(true);
  });

  test("un chip vacío se esconde salvo si está elegido; sin cuentas se enseñan todos", () => {
    const counts = {
      total: 5,
      counts: { cliente: 2, interesada: 0, comunidad: 0, personal: 1, negocio: 0, equipo: 0, otro: 0 },
      unclassified: 2,
      review: 0,
      manual: 0,
      pending: 2,
      enabled: true,
      hasModelKey: true,
      teamPhones: [],
    } as CategoryCounts;
    expect(categoryCountOf(counts, "cliente")).toBe(2);
    expect(categoryCountOf(counts, "unclassified")).toBe(2);
    expect(categoryCountOf(counts, "nada")).toBe(0);
    expect(showCategoryFilter(counts, "otro", false)).toBe(false);
    expect(showCategoryFilter(counts, "otro", true)).toBe(true);
    expect(showCategoryFilter(counts, "personal", false)).toBe(true);
    expect(showCategoryFilter({ ...counts, counts: { ...counts.counts, otro: 3 } }, "otro", false)).toBe(true);
    expect(showCategoryFilter(null, "otro", false)).toBe(true);
  });

  test("«sin clasificar»: sin categoría o con una que ya no existe", () => {
    expect(chatCategoryWhere("unclassified")).toEqual({
      OR: [{ category: null }, { category: { notIn: [...CHAT_CATEGORIES] } }],
    });
  });

  test("«revisar»: lo dudoso, nunca lo marcado a mano", () => {
    expect(chatCategoryWhere("review")).toEqual({
      categoryReview: true,
      OR: [{ categorySource: null }, { categorySource: { not: "manual" } }],
    });
  });
});
