-- Confirmación de entrega reportada por el proveedor (StatusCallback de Twilio).
ALTER TABLE "notification_deliveries" ADD COLUMN "delivered_at" TIMESTAMP(3);

-- El webhook de estado busca por provider_id en cada callback. Si la tabla ya
-- es grande en producción, crear el índice a mano con CREATE INDEX CONCURRENTLY
-- contra DIRECT_URL y marcar la migración con `prisma migrate resolve --applied`:
-- Prisma envuelve el SQL en una transacción y CONCURRENTLY no puede correr ahí.
CREATE INDEX "notification_deliveries_provider_id_idx" ON "notification_deliveries"("provider_id");
