-- Citas agendadas desde la web.
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CANCELLED');

CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "google_event_id" TEXT,
    "google_account_id" TEXT,
    "meet_url" TEXT,
    "cancel_token" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "appointments_cancel_token_key" ON "appointments"("cancel_token");
CREATE INDEX "appointments_starts_at_idx" ON "appointments"("starts_at");
CREATE INDEX "appointments_status_starts_at_idx" ON "appointments"("status", "starts_at");

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
