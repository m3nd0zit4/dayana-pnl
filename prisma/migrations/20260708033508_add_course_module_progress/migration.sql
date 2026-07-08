-- CreateTable
CREATE TABLE "course_module_progress" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_module_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_module_progress_module_id_idx" ON "course_module_progress"("module_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_module_progress_contact_id_module_id_key" ON "course_module_progress"("contact_id", "module_id");

-- AddForeignKey
ALTER TABLE "course_module_progress" ADD CONSTRAINT "course_module_progress_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_module_progress" ADD CONSTRAINT "course_module_progress_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
