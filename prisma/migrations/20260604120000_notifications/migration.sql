-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NotificationCampaignStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "MessageChannel" ADD VALUE 'SMS';

-- CreateTable
CREATE TABLE "notification_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "channels" JSONB NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'ALL_CONTACTS',
    "workshop_edition_id" TEXT,
    "status" "NotificationCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "total_targets" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_staff_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "contact_id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "template_key" TEXT,
    "subject" TEXT,
    "body_snapshot" TEXT NOT NULL,
    "recipient" TEXT,
    "provider_id" TEXT,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_campaigns_created_at_idx" ON "notification_campaigns"("created_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_campaign_id_idx" ON "notification_deliveries"("campaign_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_contact_id_created_at_idx" ON "notification_deliveries"("contact_id", "created_at");

-- AddForeignKey
ALTER TABLE "notification_campaigns" ADD CONSTRAINT "notification_campaigns_workshop_edition_id_fkey" FOREIGN KEY ("workshop_edition_id") REFERENCES "workshop_editions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "notification_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
