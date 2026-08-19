-- Suscripción recurrente de Mercado Pago (preapproval).
--
-- El cobro recurrente de MP sólo admite TARJETA — no PSE, Nequi ni efectivo —,
-- así que en Colombia la suscripción convive con el pago suelto en vez de
-- reemplazarlo.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "mercadopago_preapproval_plan_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "products_mercadopago_preapproval_plan_id_key"
  ON "products"("mercadopago_preapproval_plan_id");

ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "mercadopago_preapproval_id" TEXT;
ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "subscription_provider" "PaymentProvider";
CREATE UNIQUE INDEX IF NOT EXISTS "enrollments_mercadopago_preapproval_id_key"
  ON "enrollments"("mercadopago_preapproval_id");
