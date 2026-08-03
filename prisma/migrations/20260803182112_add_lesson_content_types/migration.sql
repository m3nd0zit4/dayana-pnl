-- CreateEnum
CREATE TYPE "LessonContentType" AS ENUM ('VIDEO', 'TEXT', 'PDF', 'QUIZ');

-- AlterTable
ALTER TABLE "live_class_sessions" ADD COLUMN     "body_md" TEXT,
ADD COLUMN     "content_type" "LessonContentType" NOT NULL DEFAULT 'VIDEO',
ADD COLUMN     "material_file_name" TEXT,
ADD COLUMN     "material_size_bytes" INTEGER,
ADD COLUMN     "material_url" TEXT,
ADD COLUMN     "quiz_json" JSONB;
