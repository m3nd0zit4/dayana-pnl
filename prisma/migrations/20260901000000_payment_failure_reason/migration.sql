-- Por qué falló un pago.
--
-- Hasta ahora un rechazo no dejaba rastro: PayPal devolvía 422 con
-- `INSTRUMENT_DECLINED` —el banco de la clienta— y el código lo aplastaba en un
-- string que nadie guardaba. El motivo real sólo se supo llamando a PayPal.
--
-- Se guarda el código CRUDO del proveedor y no sólo el texto traducido: el
-- texto puede reescribirse, pero el código es lo que sirve para reclamar meses
-- después. `failure_message` lleva el motivo ya explicado, con el `debug_id` de
-- PayPal cuando lo hay.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "failure_code" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "failure_message" TEXT;
