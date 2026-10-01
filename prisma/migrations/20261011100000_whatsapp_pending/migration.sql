-- «Pendiente» en los chats de WhatsApp: un chat queda pendiente desde que la
-- persona escribe hasta que se marca atendido (a mano, o solo al agendar una
-- cita o confirmar un pago). Responder no lo resuelve.
ALTER TABLE "conversations" ADD COLUMN "resolved_at" TIMESTAMP(3),
ADD COLUMN "resolved_reason" TEXT,
ADD COLUMN "resolved_by_id" TEXT;

-- Al estrenarlo, solo quedan pendientes los chats donde la persona escribió en
-- los últimos 3 días; lo anterior se da por atendido.
UPDATE "conversations"
SET "resolved_at" = (now() AT TIME ZONE 'UTC'), "resolved_reason" = 'backfill'
WHERE "last_inbound_at" IS NOT NULL
  AND "last_inbound_at" < (now() AT TIME ZONE 'UTC') - INTERVAL '3 days';

-- La cola «Pendientes» ordena por el último mensaje de la persona.
CREATE INDEX "conversations_channel_last_inbound_at_idx" ON "conversations"("channel", "last_inbound_at" DESC);
