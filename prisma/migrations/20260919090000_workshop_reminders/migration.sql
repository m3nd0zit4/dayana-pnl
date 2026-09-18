-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN     "workshop_reminder_1h_sent_at" TIMESTAMP(3),
ADD COLUMN     "workshop_reminder_24h_sent_at" TIMESTAMP(3);

