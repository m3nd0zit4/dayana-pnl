-- CreateEnum
CREATE TYPE "ContactNoteKind" AS ENUM ('TEXT', 'HANDWRITTEN');

-- AlterEnum
ALTER TYPE "TherapySessionStatus" ADD VALUE 'PENDING_SCHEDULE' BEFORE 'SCHEDULED';

-- CreateTable
CREATE TABLE "contact_notes" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "kind" "ContactNoteKind" NOT NULL DEFAULT 'TEXT',
    "title" TEXT,
    "body_text" TEXT,
    "therapy_session_id" TEXT,
    "enrollment_id" TEXT,
    "attachment_url" TEXT,
    "attachment_mime" TEXT,
    "attachment_name" TEXT,
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_notes_contact_id_created_at_idx" ON "contact_notes"("contact_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "contact_notes_therapy_session_id_idx" ON "contact_notes"("therapy_session_id");

-- CreateIndex
CREATE INDEX "therapy_sessions_status_scheduled_at_idx" ON "therapy_sessions"("status", "scheduled_at");

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_therapy_session_id_fkey" FOREIGN KEY ("therapy_session_id") REFERENCES "therapy_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
