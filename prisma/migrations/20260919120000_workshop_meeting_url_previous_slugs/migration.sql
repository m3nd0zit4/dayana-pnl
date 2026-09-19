-- AlterTable
ALTER TABLE "workshop_editions" ADD COLUMN     "meeting_url" TEXT,
ADD COLUMN     "previous_slugs" TEXT[] DEFAULT ARRAY[]::TEXT[];

