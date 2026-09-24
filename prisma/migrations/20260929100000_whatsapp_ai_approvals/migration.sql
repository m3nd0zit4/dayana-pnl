-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'WHATSAPP_AI_APPROVAL';

-- AlterTable
ALTER TABLE "whatsapp_ai_runs" ADD COLUMN "decided_at" TIMESTAMP(3),
ADD COLUMN "decided_by_id" TEXT,
ADD COLUMN "proposal" JSONB;
