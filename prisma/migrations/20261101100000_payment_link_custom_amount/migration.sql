-- Enlaces de pago con monto libre («Pago personalizado»). Solo agrega un valor
-- al enum y tres columnas nuevas; no cambia ni borra nada existente.
--
-- El producto oculto «pago-personalizado» NO se crea aquí: un valor de enum
-- recién añadido no se puede usar en la misma transacción. Lo crea el código
-- la primera vez que se genera un enlace (ensureCustomPaymentProduct).
ALTER TYPE "ProductKind" ADD VALUE IF NOT EXISTS 'OTHER';

ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "custom_amount_minor" INTEGER;
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "custom_currency" CHAR(3);
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "custom_concept" VARCHAR(140);
