-- Un enlace de pago pasa a saber si se cobró.
--
-- `PaymentLink` tenía `openedAt`, `checkoutStartedAt` y `revokedAt` — y nada
-- que dijera que el dinero llegó. El panel se quedaba en «Empezó a pagar»
-- para siempre: el canal de ventas afirmando que nadie compró.
--
-- `enrollmentId` va con `ON DELETE SET NULL`: si la matrícula se borra, el
-- enlace sigue constando como pagado. La fecha del cobro es un hecho que no
-- depende de que su matrícula siga existiendo.

ALTER TABLE "payment_links" ADD COLUMN "paid_at" TIMESTAMP(3);
ALTER TABLE "payment_links" ADD COLUMN "enrollment_id" TEXT;

ALTER TABLE "payment_links"
  ADD CONSTRAINT "payment_links_enrollment_id_fkey"
  FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- El índice sostiene la búsqueda de la conciliación: «un enlace de este
-- contacto, para este producto, que todavía no esté cobrado».
CREATE INDEX "payment_links_contact_id_product_id_paid_at_idx"
  ON "payment_links"("contact_id", "product_id", "paid_at");
