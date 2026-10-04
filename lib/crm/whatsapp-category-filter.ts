import type { Prisma } from "@prisma/client";

import { CHAT_CATEGORIES, isChatCategory, type ChatCategory } from "./chat-category-rules";

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
