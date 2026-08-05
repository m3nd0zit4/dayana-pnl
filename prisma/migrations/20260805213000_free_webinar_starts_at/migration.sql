-- AlterTable
ALTER TABLE "free_webinars" ADD COLUMN "starts_at" TIMESTAMP(3);

-- Deactivate rows that have no real schedule yet
UPDATE "free_webinars" SET "is_active" = false WHERE "starts_at" IS NULL;

-- Drop legacy free-text schedule columns
ALTER TABLE "free_webinars" DROP COLUMN IF EXISTS "date_label";
ALTER TABLE "free_webinars" DROP COLUMN IF EXISTS "time_label";
ALTER TABLE "free_webinars" DROP COLUMN IF EXISTS "timezone";

-- Default new rows inactive until scheduled
ALTER TABLE "free_webinars" ALTER COLUMN "is_active" SET DEFAULT false;
