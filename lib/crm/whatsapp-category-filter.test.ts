import { describe, expect, test } from "bun:test";
import { CHAT_CATEGORIES } from "./chat-category-rules";
import type { CategoryCounts } from "./chat-category";
import {
  CATEGORY_FILTERS,
  attentionSurvivesSilence,
  categoryChangeNeedsOwner,
  categoryCountOf,
  chatCategoryWhere,
  isChatCategoryFilter,
  isStaleAiLabel,
  seguimientoAllowsCategory,
  showCategoryFilter,
  showsInTeToca,
  silencesNow,
  type CategoryLabelState,
} from "./whatsapp-category-filter";

const t0 = new Date("2026-10-01T10:00:00Z");
const later = new Date("2026-10-01T11:00:00Z");
const label = (o: Partial<CategoryLabelState> = {}): CategoryLabelState => ({
  category: "personal",
  categorySource: "ai",
  categoryConfidence: 0.95,
  categoryReview: false,
  categorizedThroughAt: t0,
  lastInboundAt: t0,
  ...o,
});

describe("quién puede cambiar la categoría a mano", () => {
  const auto = { category: "interesada", categorySource: "ai" };
  test("callar un chat (personal, negocio, equipo): solo la dueña", () => {
    for (const next of ["personal", "negocio", "equipo"]) expect(categoryChangeNeedsOwner(auto, next)).toBe(true);
  });

  test("lo que no calla, cualquiera que pueda escribir", () => {
    for (const next of ["cliente", "interesada", "comunidad", "otro", null]) {
      expect(categoryChangeNeedsOwner(auto, next)).toBe(false);
    }
    expect(categoryChangeNeedsOwner({ category: "cliente", categorySource: "manual" }, "interesada")).toBe(false);
    expect(categoryChangeNeedsOwner({ category: "cliente", categorySource: "manual" }, null)).toBe(false);
  });

  test("quitar una marca a mano que callaba: solo la dueña", () => {
    const quiet = { category: "personal", categorySource: "manual" };
    expect(categoryChangeNeedsOwner(quiet, "cliente")).toBe(true);
    expect(categoryChangeNeedsOwner(quiet, null)).toBe(true);
    // Una etiqueta automática que calla no es una marca a mano: pasarla a «cliente» sí se puede.
    expect(categoryChangeNeedsOwner({ category: "personal", categorySource: "ai" }, "cliente")).toBe(false);
  });
});

describe("«Seguimiento» por categoría (encendida)", () => {
  test("nunca clientas, comunidad, personal, negocio ni equipo", () => {
    for (const c of ["cliente", "comunidad", "personal", "negocio", "equipo"]) expect(seguimientoAllowsCategory(c)).toBe(false);
  });

  test("sí interesadas, «otro» y lo sin clasificar", () => {
    for (const c of ["interesada", "otro", null]) expect(seguimientoAllowsCategory(c)).toBe(true);
  });
});

describe("silencio por categoría, en el momento", () => {
  test("la etiqueta de la IA queda vieja si la persona escribió después", () => {
    expect(isStaleAiLabel(label())).toBe(false);
    expect(isStaleAiLabel(label({ lastInboundAt: later }))).toBe(true);
    expect(isStaleAiLabel(label({ categorizedThroughAt: null }))).toBe(true);
    // Lo manual y las reglas nunca quedan viejos por esto.
    expect(isStaleAiLabel(label({ categorySource: "manual", lastInboundAt: later }))).toBe(false);
    expect(isStaleAiLabel(label({ categorySource: "rule", category: "negocio", lastInboundAt: later }))).toBe(false);
  });

  test("calla solo encendida, segura y al día", () => {
    expect(silencesNow(label(), true)).toBe(true);
    expect(silencesNow(label(), false)).toBe(false);
    expect(silencesNow(label({ lastInboundAt: later }), true)).toBe(false);
    expect(silencesNow(label({ categoryConfidence: 0.8 }), true)).toBe(false);
    expect(silencesNow(label({ categoryReview: true }), true)).toBe(false);
    expect(silencesNow(label({ categorySource: "manual", lastInboundAt: later }), true)).toBe(true);
  });

  test("el silencio solo esconde «sin responder»", () => {
    expect(attentionSurvivesSilence("unanswered")).toBe(false);
    expect(attentionSurvivesSilence(null)).toBe(false);
    for (const r of ["clinical", "payment", "complaint", "booking", "other", "error"]) {
      expect(attentionSurvivesSilence(r)).toBe(true);
    }
  });

  test("«Te toca» de un chat callado: escaladas y aprobaciones sí, «sin responder» no", () => {
    const quiet = { ...label({ categorySource: "manual" }), attentionAt: t0 };
    expect(showsInTeToca({ ...quiet, attentionReason: "unanswered" }, true)).toBe(false);
    expect(showsInTeToca({ ...quiet, attentionReason: "clinical" }, true)).toBe(true);
    expect(showsInTeToca({ ...quiet, attentionReason: "payment" }, true)).toBe(true);
    expect(showsInTeToca({ ...quiet, attentionAt: null, attentionReason: null, awaitingApproval: true }, true)).toBe(true);
    // Apagada, no se esconde nada; sin «Te toca» abierto, nada.
    expect(showsInTeToca({ ...quiet, attentionReason: "unanswered" }, false)).toBe(true);
    expect(showsInTeToca({ ...quiet, attentionAt: null, attentionReason: null }, false)).toBe(false);
    // Etiqueta vieja de la IA: no calla, le toca.
    expect(showsInTeToca({ ...label({ lastInboundAt: later }), attentionAt: t0, attentionReason: "unanswered" }, true)).toBe(true);
  });
});

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
