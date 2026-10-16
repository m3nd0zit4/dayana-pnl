-- Recordatorio de la llamada gratis 1 h antes («hoy a las… Dayana te
-- llamará»): cuándo se mandó (se reclama antes de enviar, sale una sola vez),
-- por qué no salió y por qué no hizo falta (se agendó poco antes). Solo añade.

-- AlterTable
ALTER TABLE "calendar_appointments" ADD COLUMN     "reminder_soon_error" TEXT,
ADD COLUMN     "reminder_soon_sent_at" TIMESTAMP(3),
ADD COLUMN     "reminder_soon_skipped" TEXT;
