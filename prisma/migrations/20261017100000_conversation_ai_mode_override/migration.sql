-- Lo que Dayana eligió para cada chat, aparte del modo que se quedaba pegado.
-- Con el modo general en Copiloto, cada chat que escribía quedaba guardado en
-- Copiloto para siempre (aunque el general volviera a IA). Ahora el modo de un
-- chat sale de su segmento y de este campo; null = lo decide el segmento.
-- Solo añade.

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "ai_mode_override" "WhatsAppAiMode";

-- Solo lo que de verdad eligió alguien: «Tomar chat» / Manual. El Copiloto
-- guardado vino del modo general pegado, no de una decisión por chat.
UPDATE "conversations" SET "ai_mode_override" = 'MANUAL'
WHERE "channel" = 'WHATSAPP' AND "ai_mode" = 'MANUAL';
