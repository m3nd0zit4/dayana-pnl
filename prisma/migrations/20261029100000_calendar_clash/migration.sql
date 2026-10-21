-- Choque en la agenda: un evento del calendario cae encima de una llamada gratis ya agendada. Solo agrega.
ALTER TABLE "calendar_appointments" ADD COLUMN IF NOT EXISTS "clash_event_id" TEXT;
ALTER TABLE "calendar_appointments" ADD COLUMN IF NOT EXISTS "clash_with" JSONB;
ALTER TABLE "calendar_appointments" ADD COLUMN IF NOT EXISTS "clash_notified_at" TIMESTAMP(3);
