-- Los ids de Price de Stripe viven en `products`, no en `product_prices`.
-- `product_prices` es el histórico de precios públicos y su fila más reciente
-- alimenta la web; escribir ahí el importe con gross-up de comisión inflaría
-- el precio mostrado al cliente en cada corrida de setup-products.

-- DropIndex
DROP INDEX IF EXISTS "product_prices_stripe_price_id_key";

-- AlterTable
ALTER TABLE "product_prices"
  DROP COLUMN IF EXISTS "stripe_price_id",
  DROP COLUMN IF EXISTS "stripe_recurring";

-- AlterTable
ALTER TABLE "products"
  ADD COLUMN "stripe_price_id" TEXT,
  ADD COLUMN "stripe_recurring_price_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "products_stripe_price_id_key" ON "products"("stripe_price_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_stripe_recurring_price_id_key" ON "products"("stripe_recurring_price_id");
