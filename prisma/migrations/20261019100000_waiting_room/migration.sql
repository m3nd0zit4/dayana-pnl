-- Sala de espera de la llamada gratis: cuántos avisos se le dieron a la
-- persona en cada cita y cuándo (máximo dos). Solo añade.

-- AlterTable
ALTER TABLE "calendar_appointments" ADD COLUMN     "wait_notice_at" TIMESTAMP(3),
ADD COLUMN     "wait_notice_count" INTEGER NOT NULL DEFAULT 0;

