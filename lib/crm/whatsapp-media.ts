import { prisma } from "@/lib/db";

/**
 * ¿Este id de WhatsApp es de un adjunto guardado en el CRM y todavía vigente
 * (WhatsApp guarda los archivos 7 días)? Así `/api/admin/whatsapp/media` solo
 * pide a WhatsApp lo que de verdad llegó a un chat, y sabe su tipo.
 */
export const findRecentWhatsAppMedia = async (mediaId: string): Promise<{ mimeType: string | null } | null> => {
  if (!/^\d{5,40}$/.test(mediaId)) return null;
  const rows = await prisma.$queryRaw<{ mime: string | null }[]>`
    SELECT a->>'mimeType' AS mime
      FROM conversation_messages m,
           jsonb_array_elements(CASE WHEN jsonb_typeof(m.attachments) = 'array' THEN m.attachments ELSE '[]'::jsonb END) a
     WHERE m.sent_at > now() - interval '7 days'
       AND m.attachments @> ${JSON.stringify([{ mediaId }])}::jsonb
       AND a->>'mediaId' = ${mediaId}
     LIMIT 1`;
  return rows[0] ? { mimeType: rows[0].mime } : null;
};
