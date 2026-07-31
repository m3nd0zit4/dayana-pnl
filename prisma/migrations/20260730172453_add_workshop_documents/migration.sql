-- CreateTable
CREATE TABLE "workshop_documents" (
    "id" TEXT NOT NULL,
    "workshop_edition_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workshop_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workshop_documents_workshop_edition_id_idx" ON "workshop_documents"("workshop_edition_id");

-- AddForeignKey
ALTER TABLE "workshop_documents" ADD CONSTRAINT "workshop_documents_workshop_edition_id_fkey" FOREIGN KEY ("workshop_edition_id") REFERENCES "workshop_editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
