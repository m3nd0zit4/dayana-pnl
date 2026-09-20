-- Opciones de un enlace de pago: varias para que la persona elija una.
CREATE TABLE "payment_link_options" (
    "id" TEXT NOT NULL,
    "payment_link_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_link_options_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_link_options_payment_link_id_product_id_key" ON "payment_link_options"("payment_link_id", "product_id");
CREATE INDEX "payment_link_options_product_id_idx" ON "payment_link_options"("product_id");

ALTER TABLE "payment_link_options" ADD CONSTRAINT "payment_link_options_payment_link_id_fkey" FOREIGN KEY ("payment_link_id") REFERENCES "payment_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_link_options" ADD CONSTRAINT "payment_link_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
