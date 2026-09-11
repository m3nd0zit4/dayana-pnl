-- Número de recibo por pago.
--
-- `REC-2026-0001`. Es el dato por el que la clienta y la contabilidad se
-- refieren al documento; el `cuid` del pago no se dicta por teléfono ni se
-- busca en un extracto.
--
-- El contador es una SECUENCIA de Postgres y es global, no por año. Una
-- serie por año obligaría a contar las filas del año para saber el siguiente
-- número, y dos recibos pedidos en el mismo instante se llevarían el mismo:
-- `nextval` es atómico y no puede repetir. El año del prefijo es el del cobro,
-- así que la serie no se reinicia — es preferible a un duplicado, que en un
-- documento contable es un problema de verdad.
--
-- Se asigna perezosamente, la primera vez que alguien pide el recibo, no al
-- aprobarse el pago: así los 31 pagos que ya existen también pueden tener uno
-- sin necesidad de rellenarlos todos ahora.

ALTER TABLE "payments" ADD COLUMN "receipt_number" TEXT;

CREATE UNIQUE INDEX "payments_receipt_number_key" ON "payments"("receipt_number");

CREATE SEQUENCE IF NOT EXISTS "payment_receipt_seq" AS bigint START WITH 1 INCREMENT BY 1;
