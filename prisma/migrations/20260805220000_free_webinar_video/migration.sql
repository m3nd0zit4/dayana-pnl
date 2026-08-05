-- AlterTable
ALTER TABLE "free_webinars" ADD COLUMN IF NOT EXISTS "video_url" TEXT;
ALTER TABLE "free_webinars" ADD COLUMN IF NOT EXISTS "learn_section_title" TEXT;
