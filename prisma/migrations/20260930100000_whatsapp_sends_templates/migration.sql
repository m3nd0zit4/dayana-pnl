-- AlterTable
ALTER TABLE "message_templates" ADD COLUMN     "meta_body" TEXT,
ADD COLUMN     "meta_category" TEXT,
ADD COLUMN     "meta_var_names" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "conversation_messages" ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_sends" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "template_key" TEXT,
    "vars" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "whatsapp_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_send_recipients" (
    "id" TEXT NOT NULL,
    "send_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "mode" TEXT,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "error" TEXT,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "whatsapp_send_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_sends_created_at_idx" ON "whatsapp_sends"("created_at" DESC);

-- CreateIndex
CREATE INDEX "whatsapp_send_recipients_send_id_status_idx" ON "whatsapp_send_recipients"("send_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_send_recipients_send_id_contact_id_key" ON "whatsapp_send_recipients"("send_id", "contact_id");

-- AddForeignKey
ALTER TABLE "whatsapp_send_recipients" ADD CONSTRAINT "whatsapp_send_recipients_send_id_fkey" FOREIGN KEY ("send_id") REFERENCES "whatsapp_sends"("id") ON DELETE CASCADE ON UPDATE CASCADE;

