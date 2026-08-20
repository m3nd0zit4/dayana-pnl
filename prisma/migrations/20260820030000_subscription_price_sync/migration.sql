-- El precio de la mensualidad, sincronizado con los planes de los proveedores.
--
-- `product_price_syncs` es el testigo de que PayPal y Mercado Pago aceptaron un
-- importe. `product_prices` (lo que muestra la web) sólo se escribe cuando esas
-- filas existen, y por eso la web no puede anunciar un precio que los planes no
-- estén cobrando ya.
--
-- Se guarda el histórico y no sólo el último valor porque un cobro puede llegar
-- con el precio ANTERIOR y ser correcto: PayPal no aplica un cambio de precio a
-- los pagos de los 10 días siguientes.

ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PRICE_SYNC_DRIFT';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_AMOUNT_MISMATCH';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_PRICE_PROPAGATION_FAILED';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionPriceSyncStatus') THEN
    CREATE TYPE "SubscriptionPriceSyncStatus" AS ENUM ('SYNCED', 'DRIFTED');
  END IF;
END
$$;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "price_sync_status" "SubscriptionPriceSyncStatus" NOT NULL DEFAULT 'SYNCED';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "price_sync_note" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "price_sync_checked_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "product_price_syncs" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "gross_minor" INTEGER NOT NULL,
    "net_minor" INTEGER NOT NULL,
    "external_plan_id" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_price_syncs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "product_price_syncs_product_id_provider_applied_at_idx"
  ON "product_price_syncs"("product_id", "provider", "applied_at" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_price_syncs_product_id_fkey'
  ) THEN
    ALTER TABLE "product_price_syncs"
      ADD CONSTRAINT "product_price_syncs_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
