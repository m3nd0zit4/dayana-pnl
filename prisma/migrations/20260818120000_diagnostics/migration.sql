-- CreateEnum
CREATE TYPE "DiagnosticProfile" AS ENUM ('EXPLORADOR', 'EN_PROCESO', 'RAIZ_PROFUNDA');

-- CreateTable
CREATE TABLE "diagnostics" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "contact_id" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "profile" "DiagnosticProfile",
    "urgency_score" INTEGER,
    "recommended_product_id" TEXT,
    "source" TEXT,
    "completed_at" TIMESTAMP(3),
    "viewed_result_at" TIMESTAMP(3),
    "checkout_started_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagnostics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "diagnostics_token_key" ON "diagnostics"("token");

-- CreateIndex
CREATE INDEX "diagnostics_contact_id_idx" ON "diagnostics"("contact_id");

-- CreateIndex
CREATE INDEX "diagnostics_completed_at_idx" ON "diagnostics"("completed_at" DESC);

-- AddForeignKey
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_recommended_product_id_fkey" FOREIGN KEY ("recommended_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

