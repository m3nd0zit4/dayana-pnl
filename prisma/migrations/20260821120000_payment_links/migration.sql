-- Enlaces de pago: una página con un solo producto, generada desde el panel.
--
-- El camino real de venta termina en una conversación, y hasta ahora cobrarla
-- significaba mandar a la persona al catálogo entero a buscar lo que ya se
-- había acordado. `token` es público e inadivinable, pero no decide el importe:
-- el precio se resuelve del producto en cada carga.
CREATE TABLE "payment_links" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "note" TEXT,
    "created_by_staff_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "checkout_started_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_links_token_key" ON "payment_links"("token");
CREATE INDEX "payment_links_contact_id_created_at_idx" ON "payment_links"("contact_id", "created_at" DESC);

ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
