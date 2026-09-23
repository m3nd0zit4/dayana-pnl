-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "whatsapp_reply_examples" (
    "id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "conversation_id" TEXT,
    "client_text" TEXT NOT NULL,
    "reply_text" TEXT NOT NULL,
    "embedding" vector(768),
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "replied_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_reply_examples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_known_contacts" (
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "removed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_known_contacts_pkey" PRIMARY KEY ("phone")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_reply_examples_source_key_key" ON "whatsapp_reply_examples"("source_key");

-- CreateIndex
CREATE INDEX "whatsapp_reply_examples_is_enabled_replied_at_idx" ON "whatsapp_reply_examples"("is_enabled", "replied_at" DESC);

-- AddForeignKey
ALTER TABLE "whatsapp_reply_examples" ADD CONSTRAINT "whatsapp_reply_examples_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

