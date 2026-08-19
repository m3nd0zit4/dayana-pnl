-- Lemon Squeezy (merchant of record para el checkout internacional).

-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'LEMON_SQUEEZY';

-- AlterTable
ALTER TABLE "products"
  ADD COLUMN "lemon_squeezy_product_id" TEXT,
  ADD COLUMN "lemon_squeezy_variant_id" TEXT,
  ADD COLUMN "lemon_squeezy_subscription" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "products_lemon_squeezy_variant_id_key" ON "products"("lemon_squeezy_variant_id");
