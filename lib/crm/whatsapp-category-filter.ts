import type { Prisma } from "@prisma/client";

import type { CategoryCounts } from "./chat-category";
import { CHAT_CATEGORIES, isChatCategory, isSilencingCategory, type ChatCategory } from "./chat-category-rules";

// ── Silencio por categoría, en el momento ───────────────────────────────────

/** Lo que hace falta de un chat para saber si su categoría lo calla hoy. */
export type CategoryLabelState = {
  category: string | null;
  categorySource: string | null;
  categoryConfidence?: number | null;
  categoryReview?: boolean | null;
  categorizedThroughAt?: Date | null;
  lastInboundAt?: Date | null;
};

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
