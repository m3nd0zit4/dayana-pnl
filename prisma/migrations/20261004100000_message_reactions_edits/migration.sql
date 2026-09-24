-- Reacciones, mensajes editados y eliminados.
ALTER TABLE "conversation_messages" ADD COLUMN "edited_at" TIMESTAMP(3);
ALTER TABLE "conversation_messages" ADD COLUMN "original_body" TEXT;
ALTER TABLE "conversation_messages" ADD COLUMN "revoked_at" TIMESTAMP(3);

CREATE TABLE "message_reactions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "message_reactions_message_id_actor_key" ON "message_reactions"("message_id", "actor");
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "conversation_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
