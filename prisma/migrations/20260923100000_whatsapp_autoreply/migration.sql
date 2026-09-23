-- Respuesta automática de WhatsApp: pausa por hilo y marca de mensaje.
ALTER TABLE "conversations" ADD COLUMN "ai_paused_at" TIMESTAMP(3);
ALTER TABLE "conversation_messages" ADD COLUMN "is_auto_reply" BOOLEAN NOT NULL DEFAULT false;
