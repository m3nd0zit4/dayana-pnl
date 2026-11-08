-- Números bloqueados en WhatsApp (aditivo).
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WHATSAPP_NUMBER_BLOCKED';

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "blocked_at" TIMESTAMP(3);
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "blocked_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "whatsapp_blocked_numbers" (
    "phone_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "detail" TEXT,
    "api_blocked_at" TIMESTAMP(3),
    "api_error" TEXT,
    "actions" JSONB,
    "blocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unblocked_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_blocked_numbers_pkey" PRIMARY KEY ("phone_hash")
);

CREATE INDEX IF NOT EXISTS "whatsapp_blocked_numbers_unblocked_at_idx" ON "whatsapp_blocked_numbers"("unblocked_at");
