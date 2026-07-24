-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED');

-- AlterTable
ALTER TABLE "message_logs" ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "direction" "MessageDirection" NOT NULL DEFAULT 'OUTBOUND',
ADD COLUMN     "failed_reason" TEXT,
ADD COLUMN     "media_url" TEXT,
ADD COLUMN     "provider_message_id" TEXT,
ADD COLUMN     "read_at" TIMESTAMP(3),
ADD COLUMN     "status" "MessageDeliveryStatus" NOT NULL DEFAULT 'SENT',
ADD COLUMN     "wa_context_id" TEXT;

-- AlterTable
ALTER TABLE "message_templates" ADD COLUMN     "meta_approval_status" TEXT,
ADD COLUMN     "meta_template_lang" TEXT,
ADD COLUMN     "meta_template_name" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_webhook_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "whatsapp_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_webhook_events_event_id_key" ON "whatsapp_webhook_events"("event_id");

-- CreateIndex
CREATE INDEX "message_logs_provider_message_id_idx" ON "message_logs"("provider_message_id");
