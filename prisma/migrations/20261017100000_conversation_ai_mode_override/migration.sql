-- Lo que Dayana eligió para cada chat, aparte del modo que se quedaba pegado.
-- Con el modo general en Copiloto, cada chat que escribía quedaba guardado en
-- Copiloto para siempre (aunque el general volviera a IA). Ahora el modo de un
-- chat sale de su segmento y de este campo; null = lo decide el segmento.
--
-- No se rellena desde `ai_mode`: ese valor también lo escribía en bloque el
-- interruptor general y el modo pegado, así que no dice qué eligió Dayana.
-- Los chats que ella tomó a mano siguen como favoritos (⭐), y la IA no los toca.
-- Solo añade.

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "ai_mode_override" "WhatsAppAiMode";
