-- El diagnóstico, medido y con seguimiento.
--
-- `capi_sent_at` es el sello antiduplicado del `Lead` que se manda a la
-- Conversions API, igual que `payments.capi_sent_at` lo es del Purchase: el
-- evento `diagnostic/completed` se reintenta y un Lead contado dos veces infla
-- el coste por lead de todas las campañas.
--
-- `follow_up_notified_at` se reclama antes de avisar al equipo, para que dos
-- pasadas del cron no avisen dos veces de la misma persona.

ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'DIAGNOSTIC_COMPLETED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'DIAGNOSTIC_UNCONVERTED';

ALTER TABLE "diagnostics"
  ADD COLUMN IF NOT EXISTS "capi_sent_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "follow_up_notified_at" TIMESTAMP(3);
