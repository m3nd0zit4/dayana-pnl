-- ¿Se hizo la llamada gratis? WhatsApp no avisa de las llamadas que Dayana
-- hace desde el celular: el resultado se deduce del chat o se le pregunta a
-- la persona, y si no contestó se le manda el mensaje para reagendar. Solo añade.

-- AlterTable
ALTER TABLE "calendar_appointments" ADD COLUMN     "call_outcome" TEXT,
ADD COLUMN     "call_outcome_at" TIMESTAMP(3),
ADD COLUMN     "call_outcome_reason" TEXT,
ADD COLUMN     "call_outcome_source" TEXT,
ADD COLUMN     "outcome_check_at" TIMESTAMP(3),
ADD COLUMN     "reschedule_sent_at" TIMESTAMP(3);

