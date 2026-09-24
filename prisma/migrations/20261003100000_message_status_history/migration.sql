-- Estados que solo avanzan, historial de estados, clave de envio (idempotencia).
ALTER TABLE "conversation_messages" ADD COLUMN "failed_code" INTEGER;
ALTER TABLE "conversation_messages" ADD COLUMN "status_rank" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "conversation_messages" ADD COLUMN "client_key" TEXT;
ALTER TABLE "conversation_messages" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'message';
ALTER TABLE "conversation_messages" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Rango de los mensajes que ya existen, segun su estado actual.
UPDATE "conversation_messages" SET "status_rank" = CASE "status"
  WHEN 'SENT' THEN 1 WHEN 'DELIVERED' THEN 2 WHEN 'READ' THEN 3 WHEN 'FAILED' THEN 4 ELSE 0 END;
UPDATE "conversation_messages" SET "updated_at" = COALESCE("read_at", "delivered_at", "sent_at");

CREATE UNIQUE INDEX "conversation_messages_client_key_key" ON "conversation_messages"("client_key");
CREATE INDEX "conversation_messages_conversation_id_updated_at_idx" ON "conversation_messages"("conversation_id", "updated_at");
CREATE INDEX "conversation_messages_source_idx" ON "conversation_messages"("source");
CREATE INDEX "conversation_messages_direction_is_auto_reply_sent_at_idx" ON "conversation_messages"("direction", "is_auto_reply", "sent_at");
CREATE INDEX "conversations_channel_last_message_at_idx" ON "conversations"("channel", "last_message_at" DESC);

CREATE TABLE "message_status_events" (
    "id" TEXT NOT NULL,
    "message_id" TEXT,
    "wamid" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "error_code" INTEGER,
    "error_title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_status_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "message_status_events_wamid_status_key" ON "message_status_events"("wamid", "status");
CREATE INDEX "message_status_events_message_id_idx" ON "message_status_events"("message_id");
ALTER TABLE "message_status_events" ADD CONSTRAINT "message_status_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "conversation_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
