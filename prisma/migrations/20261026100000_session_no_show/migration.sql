-- Sesión pagada a la que la persona no entró (la mira la API de Meet). Solo agrega.
ALTER TYPE "GoogleService" ADD VALUE IF NOT EXISTS 'MEET';
ALTER TABLE "calendar_appointments" ADD COLUMN "no_show_state" TEXT;
ALTER TABLE "calendar_appointments" ADD COLUMN "no_show_at" TIMESTAMP(3);
