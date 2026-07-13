-- AlterTable
ALTER TABLE "live_class_sessions" ADD COLUMN     "module_id" TEXT,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "course_class_progress" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_class_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_class_progress_class_id_idx" ON "course_class_progress"("class_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_class_progress_contact_id_class_id_key" ON "course_class_progress"("contact_id", "class_id");

-- CreateIndex
CREATE INDEX "live_class_sessions_module_id_sort_order_idx" ON "live_class_sessions"("module_id", "sort_order");

-- AddForeignKey
ALTER TABLE "live_class_sessions" ADD CONSTRAINT "live_class_sessions_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_class_progress" ADD CONSTRAINT "course_class_progress_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_class_progress" ADD CONSTRAINT "course_class_progress_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "live_class_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
