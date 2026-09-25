-- Citas del Google Calendar ligadas a la persona (numero, recordatorio 24 h).
CREATE TABLE "calendar_appointments" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "google_account_id" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "sessions_label" TEXT,
    "meet_url" TEXT,
    "contact_id" TEXT,
    "conversation_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'active',
    "match_state" TEXT NOT NULL DEFAULT 'unmatched',
    "candidates" JSONB,
    "confirmed_at" TIMESTAMP(3),
    "reminder_sent_at" TIMESTAMP(3),
    "reminder_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calendar_appointments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "calendar_appointments_event_id_key" ON "calendar_appointments"("event_id");
CREATE INDEX "calendar_appointments_starts_at_idx" ON "calendar_appointments"("starts_at");
CREATE INDEX "calendar_appointments_contact_id_idx" ON "calendar_appointments"("contact_id");
CREATE INDEX "calendar_appointments_phone_idx" ON "calendar_appointments"("phone");
