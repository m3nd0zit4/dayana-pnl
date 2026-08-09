-- Ciclo de vida del webinar gratuito: cierre automático, archivo manual e
-- historial de ediciones, más el motivo del último fallo de envío.
--
-- Aditiva: la fila existente queda con los cuatro valores en NULL, que se lee
-- exactamente como «edición viva, sin terminar y sin fallos». Sin backfill.

-- AlterTable
ALTER TABLE "free_webinars"
  ADD COLUMN "ended_at" TIMESTAMP(3),
  ADD COLUMN "archived_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "free_webinars_archived_at_idx" ON "free_webinars"("archived_at");

-- AlterTable
ALTER TABLE "webinar_registrations"
  ADD COLUMN "last_send_error" TEXT,
  ADD COLUMN "last_send_error_at" TIMESTAMP(3);
