-- Contenido permanente de la biblioteca.
--
-- Una réplica de clase en vivo caduca a los 30 días (RECORDING_RETENTION_DAYS
-- y el cron `recording-auto-hide`). Una lección pregrabada del catálogo no:
-- sin esta marca el curso se vaciaría solo al mes de publicarse.

-- AlterTable
ALTER TABLE "live_class_sessions"
  ADD COLUMN "evergreen" BOOLEAN NOT NULL DEFAULT false;
