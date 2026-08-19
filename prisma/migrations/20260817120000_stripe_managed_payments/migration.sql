-- Stripe / Managed Payments

-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'STRIPE';

-- AlterTable
ALTER TABLE "products"
  ADD COLUMN "stripe_product_id" TEXT,
  ADD COLUMN "stripe_tax_code" TEXT,
  ADD COLUMN "stripe_managed_payments" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "product_prices"
  ADD COLUMN "stripe_price_id" TEXT,
  ADD COLUMN "stripe_recurring" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "products_stripe_product_id_key" ON "products"("stripe_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_prices_stripe_price_id_key" ON "product_prices"("stripe_price_id");
