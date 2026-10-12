import { prisma } from "@/lib/db";
import type { TranscriptLine } from "./brain";

/**
 * Lo viejo que toca el mismo tema: mensajes del MISMO chat, anteriores a lo
 * que la IA ya lee, que coinciden con lo que la persona acaba de escribir
 * (búsqueda de texto en español). Si escribe «¿y lo de la sesión del martes?»
 * y eso se habló hace dos meses, la IA lo ve aunque no esté en los últimos
 * mensajes. Sin índice a propósito: es un solo chat.
 */
export const olderSnippets = async (input: {
  conversationId: string;
  /** Lo que la IA ya lee empieza aquí: se busca antes. */
  before: Date;
  query: string;
  limit: number;
}): Promise<TranscriptLine[]> => {
  const query = input.query.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!query || input.limit <= 0) return [];
  const rows = await prisma.$queryRaw<
    { direction: string; body: string; sent_at: Date; is_auto_reply: boolean; external_message_id: string | null }[]
  >`
    SELECT direction::text AS direction, body, sent_at, is_auto_reply, external_message_id
    FROM conversation_messages
    WHERE conversation_id = ${input.conversationId}
      AND sent_at < ${input.before}
      AND kind <> 'system'
      AND body IS NOT NULL
      AND to_tsvector('spanish', body) @@ plainto_tsquery('spanish', ${query})
    ORDER BY ts_rank(to_tsvector('spanish', body), plainto_tsquery('spanish', ${query})) DESC, sent_at DESC
    LIMIT ${input.limit}`;
  return rows
    .sort((a, b) => a.sent_at.getTime() - b.sent_at.getTime())
    .map((r) => ({
      direction: r.direction === "INBOUND" ? "INBOUND" : "OUTBOUND",
      body: r.body,
      sentAt: r.sent_at,
      isAutoReply: r.is_auto_reply,
      imported: r.external_message_id?.startsWith("export:") || undefined,
    }));
};
