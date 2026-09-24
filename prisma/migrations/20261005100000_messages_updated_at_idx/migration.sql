-- La pantalla en vivo pregunta por el ultimo cambio de cualquier mensaje.
CREATE INDEX IF NOT EXISTS "conversation_messages_updated_at_idx" ON "conversation_messages"("updated_at");
