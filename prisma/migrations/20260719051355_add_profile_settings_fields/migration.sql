-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "avatar_url" TEXT,
ADD COLUMN     "notify_email" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_sms" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_whatsapp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "theme_preference" TEXT NOT NULL DEFAULT 'system',
ADD COLUMN     "work_description" TEXT;

-- AlterTable
ALTER TABLE "staff_users" ADD COLUMN     "avatar_url" TEXT,
ADD COLUMN     "notify_email" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "theme_preference" TEXT NOT NULL DEFAULT 'system';
