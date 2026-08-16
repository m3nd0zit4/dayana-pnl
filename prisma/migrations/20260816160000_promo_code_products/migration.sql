-- Limitar un código promocional a ciertos productos.
--
-- Sin filas para un código, el código vale para TODO: por eso esta migración
-- es puramente aditiva y no necesita backfill. Los códigos que ya están en
-- circulación siguen aplicándose a cualquier producto, exactamente igual que
-- antes, y solo queda restringido aquel al que alguien le elija productos.

-- CreateTable
CREATE TABLE "promo_code_products" (
    "promo_code_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,

    CONSTRAINT "promo_code_products_pkey" PRIMARY KEY ("promo_code_id","product_id")
);

-- CreateIndex
CREATE INDEX "promo_code_products_product_id_idx" ON "promo_code_products"("product_id");

-- AddForeignKey
ALTER TABLE "promo_code_products" ADD CONSTRAINT "promo_code_products_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_products" ADD CONSTRAINT "promo_code_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
