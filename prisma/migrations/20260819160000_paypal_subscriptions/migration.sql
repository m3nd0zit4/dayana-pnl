-- Suscripción recurrente de la mensualidad en PayPal.
--
-- `paypal_plan_id` guarda el Billing Plan CON el gross-up de comisión ya
-- aplicado: los planes cobran importe fijo, no calculado por petición. No va en
-- product_prices porque esa tabla es el precio público.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "paypal_product_id" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "paypal_plan_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "products_paypal_product_id_key" ON "products"("paypal_product_id");
CREATE UNIQUE INDEX IF NOT EXISTS "products_paypal_plan_id_key" ON "products"("paypal_plan_id");

DO $$ BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- `paypal_subscription_id` es la clave por la que se resuelve cada cobro:
-- PAYMENT.SALE.COMPLETED trae billing_agreement_id y no garantiza el custom_id.
ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "paypal_subscription_id" TEXT;
ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "subscription_status" "SubscriptionStatus";
CREATE UNIQUE INDEX IF NOT EXISTS "enrollments_paypal_subscription_id_key" ON "enrollments"("paypal_subscription_id");

ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_STARTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_PAYMENT_FAILED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_CANCELLED';
