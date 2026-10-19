-- Te esperan en la sala: aviso a Dayana a la hora de una sesión con Meet. Solo agrega.
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WHATSAPP_SESSION_WAITING';
ALTER TABLE "calendar_appointments" ADD COLUMN "arrival_notified_at" TIMESTAMP(3);
ALTER TABLE "calendar_appointments" ADD COLUMN "arrival_source" TEXT;
