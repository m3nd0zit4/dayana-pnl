import { describe, expect, test } from "bun:test";
import { CHAT_CATEGORIES } from "./chat-category-rules";
import { chatCategoryWhere, isChatCategoryFilter } from "./whatsapp-category-filter";

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

  test("una categoría es esa categoría", () => {
    expect(chatCategoryWhere("negocio")).toEqual({ category: "negocio" });
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
