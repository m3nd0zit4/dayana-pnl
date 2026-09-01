-- Fuera Stripe y Lemon Squeezy.
--
-- Ninguno llegó a cobrar nada: cero pagos con esos proveedores y ninguna
-- variable de entorno definida en producción. Eran cuatro rieles en el código
-- para dos que funcionan, y cada uno era un sitio más donde un error podía
-- perderse.
--
-- Postgres no permite quitar valores de un enum, así que se recrea el tipo. Es
-- seguro porque ninguna fila los usa — comprobado antes de escribir esto:
--   SELECT provider, count(*) FROM payments GROUP BY provider;
--   → PAYPAL 26, MANUAL 3, MERCADO_PAGO 2
--
-- Si algún día vuelven, están en el historial de git en un commit aislado.

ALTER TABLE "products" DROP COLUMN IF EXISTS "stripe_product_id";
ALTER TABLE "products" DROP COLUMN IF EXISTS "stripe_tax_code";
ALTER TABLE "products" DROP COLUMN IF EXISTS "stripe_price_id";
ALTER TABLE "products" DROP COLUMN IF EXISTS "stripe_recurring_price_id";
ALTER TABLE "products" DROP COLUMN IF EXISTS "stripe_managed_payments";
ALTER TABLE "products" DROP COLUMN IF EXISTS "lemon_squeezy_product_id";
ALTER TABLE "products" DROP COLUMN IF EXISTS "lemon_squeezy_variant_id";
ALTER TABLE "products" DROP COLUMN IF EXISTS "lemon_squeezy_subscription";

-- Los `webhook_events` son marcas de idempotencia («este aviso ya lo procesé»),
-- no dinero: los de un proveedor que ya no existe no sirven para nada y se
-- borran. Es la ÚNICA tabla donde se borra: en `payments` un valor inesperado
-- debe hacer fallar la migración, no desaparecer.
DELETE FROM "webhook_events" WHERE "provider"::text IN ('STRIPE', 'LEMON_SQUEEZY');

-- El enum se recrea sin los dos valores. `USING` reasigna cada fila existente;
-- si quedara alguna con STRIPE o LEMON_SQUEEZY esto fallaría en vez de perder
-- el dato en silencio, que es justo lo que se quiere.
ALTER TYPE "PaymentProvider" RENAME TO "PaymentProvider_old";
CREATE TYPE "PaymentProvider" AS ENUM ('PAYPAL', 'MERCADO_PAGO', 'MANUAL');
ALTER TABLE "payments"
  ALTER COLUMN "provider" TYPE "PaymentProvider"
  USING ("provider"::text::"PaymentProvider");
ALTER TABLE "product_price_syncs"
  ALTER COLUMN "provider" TYPE "PaymentProvider"
  USING ("provider"::text::"PaymentProvider");
ALTER TABLE "enrollments"
  ALTER COLUMN "subscription_provider" TYPE "PaymentProvider"
  USING ("subscription_provider"::text::"PaymentProvider");
-- `webhook_events` también lo usa. Se enumeraron con information_schema en vez
-- de de memoria, que es como se olvidó esta la primera vez.
ALTER TABLE "webhook_events"
  ALTER COLUMN "provider" TYPE "PaymentProvider"
  USING ("provider"::text::"PaymentProvider");
DROP TYPE "PaymentProvider_old";
