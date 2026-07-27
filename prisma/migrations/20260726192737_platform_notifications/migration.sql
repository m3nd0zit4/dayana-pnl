-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('PAYMENT_APPROVED', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED', 'MANUAL_PAYMENT_RECORDED', 'PAYMENT_WEBHOOK_FAILED', 'LEAD_CREATED', 'WEB_LEAD_SUBMITTED', 'ENROLLMENT_PENDING_PAYMENT', 'ENROLLMENT_ACTIVATED', 'ENROLLMENT_STATUS_CHANGED', 'CHECKOUT_ABANDONED', 'LEAD_STALE', 'THERAPY_SESSION_SCHEDULED', 'THERAPY_SESSION_RESCHEDULED', 'THERAPY_SESSION_COMPLETED', 'THERAPY_SESSION_NO_SHOW', 'MEMBER_SIGNED_UP', 'MEMBERSHIP_DUE_SOON', 'MEMBERSHIP_OVERDUE', 'MEMBERSHIP_EXTENDED', 'LESSON_COMMENT_POSTED', 'CLASS_RECORDING_PUBLISHED', 'LOGIN_FAILED', 'LOGIN_SUCCEEDED', 'STAFF_USER_CREATED', 'AGENT_ACTION_EXECUTED', 'CAMPAIGN_COMPLETED', 'NOTIFICATION_DELIVERY_FAILED', 'SYSTEM_ALERT');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "notify_in_app" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "notification_deliveries" ADD COLUMN     "platform_notification_id" TEXT,
ADD COLUMN     "staff_user_id" TEXT,
ALTER COLUMN "contact_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "platform_notifications" (
    "id" TEXT NOT NULL,
    "event_type" "NotificationEventType" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "href" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_recipients" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "staff_user_id" TEXT,
    "contact_id" TEXT,
    "read_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "emailed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_notification_preferences" (
    "id" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "event_type" "NotificationEventType" NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_notifications_created_at_idx" ON "platform_notifications"("created_at");

-- CreateIndex
CREATE INDEX "platform_notifications_event_type_created_at_idx" ON "platform_notifications"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "platform_notifications_entity_type_entity_id_idx" ON "platform_notifications"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "notification_recipients_staff_user_id_created_at_idx" ON "notification_recipients"("staff_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_recipients_contact_id_created_at_idx" ON "notification_recipients"("contact_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notification_recipients_notification_id_staff_user_id_key" ON "notification_recipients"("notification_id", "staff_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_recipients_notification_id_contact_id_key" ON "notification_recipients"("notification_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_notification_preferences_staff_user_id_event_type_key" ON "staff_notification_preferences"("staff_user_id", "event_type");

-- CreateIndex
CREATE INDEX "notification_deliveries_staff_user_id_created_at_idx" ON "notification_deliveries"("staff_user_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_created_at_idx" ON "notification_deliveries"("status", "created_at");

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_platform_notification_id_fkey" FOREIGN KEY ("platform_notification_id") REFERENCES "platform_notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "platform_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_notification_preferences" ADD CONSTRAINT "staff_notification_preferences_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
