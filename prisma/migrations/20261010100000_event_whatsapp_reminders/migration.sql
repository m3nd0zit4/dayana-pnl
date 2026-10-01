-- Recordatorios del evento gratuito por WhatsApp: sello por pasada y último error.
ALTER TABLE "webinar_registrations"
  ADD COLUMN "reminder_24h_wa_sent_at" TIMESTAMP(3),
  ADD COLUMN "reminder_1h_wa_sent_at" TIMESTAMP(3),
  ADD COLUMN "wa_reminder_error" TEXT,
  ADD COLUMN "wa_reminder_error_at" TIMESTAMP(3);
