-- CreateEnum
CREATE TYPE "NotebookPageKind" AS ENUM ('CANVAS', 'UPLOAD');

-- CreateEnum
CREATE TYPE "NotebookPageBackground" AS ENUM ('BLANK', 'RULED', 'GRID');

-- CreateTable
CREATE TABLE "contact_notebook_pages" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "kind" "NotebookPageKind" NOT NULL DEFAULT 'CANVAS',
    "background" "NotebookPageBackground" NOT NULL DEFAULT 'BLANK',
    "canvas_data" JSONB,
    "body_text" TEXT,
    "attachment_url" TEXT,
    "attachment_mime" TEXT,
    "attachment_name" TEXT,
    "preview_url" TEXT,
    "therapy_session_id" TEXT,
    "enrollment_id" TEXT,
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_notebook_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_notebook_pages_contact_id_sort_order_idx" ON "contact_notebook_pages"("contact_id", "sort_order");

-- CreateIndex
CREATE INDEX "contact_notebook_pages_contact_id_updated_at_idx" ON "contact_notebook_pages"("contact_id", "updated_at" DESC);

-- AddForeignKey
ALTER TABLE "contact_notebook_pages" ADD CONSTRAINT "contact_notebook_pages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notebook_pages" ADD CONSTRAINT "contact_notebook_pages_therapy_session_id_fkey" FOREIGN KEY ("therapy_session_id") REFERENCES "therapy_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notebook_pages" ADD CONSTRAINT "contact_notebook_pages_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notebook_pages" ADD CONSTRAINT "contact_notebook_pages_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
