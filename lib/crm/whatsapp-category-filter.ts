import type { Prisma } from "@prisma/client";

import type { CategoryCounts } from "./chat-category";
import {
  CHAT_CATEGORIES,
  isChatCategory,
  isSilencingCategory,
  isSilentCategory,
  type ChatCategory,
} from "./chat-category-rules";

// ── Silencio por categoría, en el momento ───────────────────────────────────

/**
 * Lo que hace falta de un chat para saber si su categoría lo calla hoy. Todo
 * obligatorio (puede ser `null`): olvidar `categorizedThroughAt` o
 * `lastInboundAt` en el `select` daría una etiqueta «al día» que no lo está.
 */
export type CategoryLabelState = {
  category: string | null;
  categorySource: string | null;
  categoryConfidence: number | null;
  categoryReview: boolean | null;
  categorizedThroughAt: Date | null;
  lastInboundAt: Date | null;
};

/**
 * ¿Este cambio de categoría a mano lo puede hacer solo la dueña? Sí si deja el
 * chat callado (personal, negocio/app, equipo) o si quita una marca a mano que
 * lo callaba: las dos cosas deciden si la IA contesta. Lo demás, cualquiera que
 * pueda escribir.
 */
export const categoryChangeNeedsOwner = (
  current: { category: string | null; categorySource: string | null },
  next: string | null
): boolean =>
  isSilentCategory(next) ||
  (current.categorySource === "manual" && isSilentCategory(current.category) && next !== current.category);

/**
 * Etiqueta de la IA que quedó vieja: la persona escribió después de que la IA
 * la mirara. No calla hasta que se vuelva a mirar (la IA lo hace en el momento,
 * antes de contestar). El mismo criterio que `notSilencedChatsWhere` en SQL.
 */
export const isStaleAiLabel = (c: CategoryLabelState): boolean =>
  c.categorySource === "ai" &&
  (!c.categorizedThroughAt ||
    (c.lastInboundAt != null && c.lastInboundAt.getTime() > c.categorizedThroughAt.getTime()));

/** ¿La categoría calla este chat ahora mismo? (encendida, etiqueta segura y al día). */
export const silencesNow = (c: CategoryLabelState, enabled: boolean): boolean =>
  isSilencingCategory(c, { enabled }) && !isStaleAiLabel(c);

/**
 * El silencio solo esconde «sin responder». Una escalada (pago, clínico,
 * queja, urgencia…) le toca igual aunque el chat esté callado.
 */
export const attentionSurvivesSilence = (reason: string | null | undefined): boolean =>
  Boolean(reason) && reason !== "unanswered";

/** ¿Sale en «Te toca»? El mismo criterio que `attentionWhere` (para la insignia y la barra). */
export const showsInTeToca = (
  c: CategoryLabelState & { attentionAt: Date | null; attentionReason: string | null; awaitingApproval?: boolean },
  enabled: boolean
): boolean =>
  Boolean(c.awaitingApproval) ||
  (c.attentionAt != null && (attentionSurvivesSilence(c.attentionReason) || !silencesNow(c, enabled)));

/**
 * «Seguimiento» es seguimiento de ventas: con la clasificación encendida, un
 * chat con una de estas categorías nunca entra, sea de una regla, de la IA o a
 * mano, dudosa o vieja. Sí entran las interesadas, «otro» y lo sin clasificar.
 */
export const SEGUIMIENTO_EXCLUDED_CATEGORIES: readonly ChatCategory[] = [
  "cliente",
  "comunidad",
  "personal",
  "negocio",
  "equipo",
];

/** La misma regla en puro (`seguimientoWhere` la aplica en SQL). */
export const seguimientoAllowsCategory = (category: string | null): boolean =>
  !category || !(SEGUIMIENTO_EXCLUDED_CATEGORIES as readonly string[]).includes(category);

// ── Filtros de categoría («Todos», Personas) ─────────────────────────────────

/**
 * El filtro de categoría de «Todos» (y de Personas): una categoría, sin
 * clasificar o por revisar. Puro (sin base de datos) para poder probarlo.
 */
export type ChatCategoryFilter = ChatCategory | "unclassified" | "review";

export const isChatCategoryFilter = (v: unknown): v is ChatCategoryFilter =>
  v === "unclassified" || v === "review" || isChatCategory(v);

export const chatCategoryWhere = (filter: ChatCategoryFilter | null | undefined): Prisma.ConversationWhereInput => {
  if (!filter) return {};
  // Sin clasificar: sin categoría (o con una que ya no existe).
  if (filter === "unclassified") return { OR: [{ category: null }, { category: { notIn: [...CHAT_CATEGORIES] } }] };
  // Lo que se marcó a mano no está por revisar (como en el contador de Ajustes).
  if (filter === "review") {
    return { categoryReview: true, OR: [{ categorySource: null }, { categorySource: { not: "manual" } }] };
  }
  return { category: filter };
};

/** Los chips de categoría, en este orden: uno por categoría, más «sin clasificar» y «revisar». */
export const CATEGORY_FILTERS: { id: ChatCategoryFilter; label: string }[] = [
  { id: "cliente", label: "Clientes" },
  { id: "interesada", label: "Interesadas" },
  { id: "comunidad", label: "Comunidad" },
  { id: "personal", label: "Personales" },
  { id: "negocio", label: "Negocios" },
  { id: "equipo", label: "Equipo" },
  { id: "otro", label: "Otros" },
  { id: "unclassified", label: "Sin clasificar" },
  { id: "review", label: "Revisar" },
];

/** Cuántos chats hay en un filtro (0 si aún no se sabe). */
export const categoryCountOf = (c: CategoryCounts | null, id: string): number => {
  if (!c) return 0;
  if (id === "unclassified") return c.unclassified;
  if (id === "review") return c.review;
  return isChatCategory(id) ? (c.counts[id] ?? 0) : 0;
};

/** Un filtro sin chats no se enseña, salvo si está elegido (o si aún no hay cuentas). */
export const showCategoryFilter = (c: CategoryCounts | null, id: string, active: boolean): boolean =>
  !c || active || categoryCountOf(c, id) > 0;
