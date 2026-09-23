-- CreateEnum
CREATE TYPE "WhatsAppAiMode" AS ENUM ('AUTO', 'COPILOT', 'MANUAL');

-- AlterEnum


ALTER TYPE "NotificationEventType" ADD VALUE 'WHATSAPP_AI_ESCALATED';
ALTER TYPE "NotificationEventType" ADD VALUE 'WHATSAPP_AI_BOOKED';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "ai_mode" "WhatsAppAiMode" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "escalation_category" TEXT,
ADD COLUMN     "escalation_reason" TEXT,
ADD COLUMN     "escalation_severity" TEXT,
ADD COLUMN     "priority_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "whatsapp_ai_runs" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "category" TEXT,
    "severity" TEXT,
    "trigger_message_id" TEXT,
    "tool_calls" JSONB,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "latency_ms" INTEGER,

    CONSTRAINT "whatsapp_ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_bookings" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "service" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "google_account_id" TEXT NOT NULL,
    "calendar_event_id" TEXT NOT NULL,
    "meet_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_memories" (
    "phone" TEXT NOT NULL,
    "contact_id" TEXT,
    "notes" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_memories_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE "whatsapp_playbooks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "steps" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_playbooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_ai_runs_conversation_id_queued_at_idx" ON "whatsapp_ai_runs"("conversation_id", "queued_at" DESC);

-- CreateIndex
CREATE INDEX "whatsapp_ai_runs_queued_at_idx" ON "whatsapp_ai_runs"("queued_at" DESC);

-- CreateIndex
CREATE INDEX "whatsapp_bookings_starts_at_idx" ON "whatsapp_bookings"("starts_at");

-- CreateIndex
CREATE INDEX "whatsapp_bookings_conversation_id_idx" ON "whatsapp_bookings"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_staff_user_id_idx" ON "push_subscriptions"("staff_user_id");

-- AddForeignKey
ALTER TABLE "whatsapp_ai_runs" ADD CONSTRAINT "whatsapp_ai_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_bookings" ADD CONSTRAINT "whatsapp_bookings_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

