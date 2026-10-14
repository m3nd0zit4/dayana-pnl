-- Comprobantes de pago que llegan por WhatsApp, por confirmar por Dayana. Solo crea una tabla.
CREATE TABLE "whatsapp_payment_receipts" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "message_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "method" TEXT,
    "amount_minor" INTEGER,
    "currency" CHAR(3),
    "reference" TEXT,
    "paid_on" TEXT,
    "payer_name" TEXT,
    "summary" TEXT,
    "problem" TEXT,
    "confirm_message" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_payment_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whatsapp_payment_receipts_status_created_at_idx" ON "whatsapp_payment_receipts"("status", "created_at");
CREATE INDEX "whatsapp_payment_receipts_conversation_id_created_at_idx" ON "whatsapp_payment_receipts"("conversation_id", "created_at");

ALTER TABLE "whatsapp_payment_receipts" ADD CONSTRAINT "whatsapp_payment_receipts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
