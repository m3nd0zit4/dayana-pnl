/*
  Warnings:

  - Made the column `title` on table `message_templates` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "message_templates" ALTER COLUMN "title" SET NOT NULL,
ALTER COLUMN "title" SET DEFAULT '';

-- AlterTable
ALTER TABLE "workshop_editions" ADD COLUMN     "day_schedule" JSONB,
ADD COLUMN     "detail_summary" TEXT,
ADD COLUMN     "focus_topics" JSONB,
ADD COLUMN     "hero_line_1" TEXT,
ADD COLUMN     "hero_line_2" TEXT,
ADD COLUMN     "hero_line_3" TEXT,
ADD COLUMN     "intro" TEXT,
ADD COLUMN     "intro_open" TEXT,
ADD COLUMN     "meta_description" TEXT,
ADD COLUMN     "meta_title" TEXT,
ADD COLUMN     "schedule_section_description" TEXT,
ADD COLUMN     "topics_section_description" TEXT,
ADD COLUMN     "topics_section_title" TEXT;
