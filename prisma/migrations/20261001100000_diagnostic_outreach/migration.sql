-- Autoevaluacion -> WhatsApp: donde/cuando se hizo y la lectura de la IA.
ALTER TABLE "diagnostics" ADD COLUMN "client_timezone" TEXT;
ALTER TABLE "diagnostics" ADD COLUMN "ip_country" TEXT;
ALTER TABLE "diagnostics" ADD COLUMN "ip_city" TEXT;
ALTER TABLE "diagnostics" ADD COLUMN "ip_timezone" TEXT;
ALTER TABLE "diagnostics" ADD COLUMN "ai_analysis" JSONB;
ALTER TABLE "diagnostics" ADD COLUMN "outreach_status" TEXT;
ALTER TABLE "diagnostics" ADD COLUMN "outreach_reason" TEXT;
ALTER TABLE "diagnostics" ADD COLUMN "outreach_at" TIMESTAMP(3);
ALTER TABLE "diagnostics" ADD COLUMN "outreach_conversation_id" TEXT;
