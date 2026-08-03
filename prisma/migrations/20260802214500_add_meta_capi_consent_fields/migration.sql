-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "consent_ad_tracking_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "capi_sent_at" TIMESTAMP(3);
