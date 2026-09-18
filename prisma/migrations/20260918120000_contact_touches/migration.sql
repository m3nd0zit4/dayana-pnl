-- CreateEnum
CREATE TYPE "ContactTouchKind" AS ENUM ('LEAD_WHATSAPP', 'STAFF_WHATSAPP');

-- CreateTable
CREATE TABLE "contact_touches" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT,
    "diagnostic_id" TEXT,
    "staff_user_id" TEXT,
    "kind" "ContactTouchKind" NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_touches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_touches_contact_id_kind_created_at_idx" ON "contact_touches"("contact_id", "kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "contact_touches_diagnostic_id_idx" ON "contact_touches"("diagnostic_id");

-- AddForeignKey
ALTER TABLE "contact_touches" ADD CONSTRAINT "contact_touches_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_touches" ADD CONSTRAINT "contact_touches_diagnostic_id_fkey" FOREIGN KEY ("diagnostic_id") REFERENCES "diagnostics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_touches" ADD CONSTRAINT "contact_touches_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
