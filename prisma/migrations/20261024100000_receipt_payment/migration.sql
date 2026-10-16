-- Comprobantes de WhatsApp: cómo se confirmó (botón del CRM o Dayana en el chat)
-- y el pago del CRM que le corresponde. Solo columnas nuevas, nada se borra.
ALTER TABLE "whatsapp_payment_receipts" ADD COLUMN "confirmed_via" TEXT;
ALTER TABLE "whatsapp_payment_receipts" ADD COLUMN "payment_id" TEXT;
ALTER TABLE "whatsapp_payment_receipts" ADD COLUMN "payment_dismissed_at" TIMESTAMP(3);
