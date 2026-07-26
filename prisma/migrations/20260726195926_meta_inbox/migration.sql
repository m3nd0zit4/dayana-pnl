-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('WHATSAPP', 'MESSENGER', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED');

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'INBOX_MESSAGE_RECEIVED';

-- RenameTable
--
-- Editado a mano: Prisma generaba DROP + CREATE. La tabla de deduplicación de
-- WhatsApp pasa a cubrir los tres canales de Meta, así que se renombra en vez
-- de recrearse — el DROP tiraría el historial de idempotencia y volvería a
-- procesar como nuevos los mensajes ya vistos.
ALTER TABLE "whatsapp_webhook_events" RENAME TO "meta_webhook_events";
ALTER TABLE "meta_webhook_events" RENAME CONSTRAINT "whatsapp_webhook_events_pkey" TO "meta_webhook_events_pkey";
ALTER INDEX "whatsapp_webhook_events_event_id_key" RENAME TO "meta_webhook_events_event_id_key";

-- AlterTable
-- El DEFAULT solo existe para poder añadir la columna como NOT NULL sobre las
-- filas que ya estén; el modelo de Prisma no lo declara, así que se retira.
ALTER TABLE "meta_webhook_events" ADD COLUMN "object" TEXT NOT NULL DEFAULT 'whatsapp_business_account';
ALTER TABLE "meta_webhook_events" ALTER COLUMN "object" DROP DEFAULT;

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "external_thread_id" TEXT NOT NULL,
    "meta_account_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "participant_name" TEXT,
    "participant_handle" TEXT,
    "participant_avatar_url" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_staff_id" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_inbound_at" TIMESTAMP(3),
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "draft_body" TEXT,
    "draft_source" TEXT,
    "draft_updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "status" "MessageDeliveryStatus" NOT NULL DEFAULT 'SENT',
    "external_message_id" TEXT,
    "reply_to_external_id" TEXT,
    "body" TEXT,
    "attachments" JSONB,
    "staff_user_id" TEXT,
    "is_echo" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "failed_reason" TEXT,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_channel_identities" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "external_id" TEXT NOT NULL,
    "display_name" TEXT,
    "linked_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_channel_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_status_last_message_at_idx" ON "conversations"("status", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_contact_id_last_message_at_idx" ON "conversations"("contact_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_assigned_staff_id_last_message_at_idx" ON "conversations"("assigned_staff_id", "last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_channel_external_thread_id_key" ON "conversations"("channel", "external_thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_external_message_id_key" ON "conversation_messages"("external_message_id");

-- CreateIndex
CREATE INDEX "conversation_messages_conversation_id_sent_at_idx" ON "conversation_messages"("conversation_id", "sent_at");

-- CreateIndex
CREATE INDEX "contact_channel_identities_contact_id_idx" ON "contact_channel_identities"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_channel_identities_channel_external_id_key" ON "contact_channel_identities"("channel", "external_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_staff_id_fkey" FOREIGN KEY ("assigned_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_channel_identities" ADD CONSTRAINT "contact_channel_identities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_channel_identities" ADD CONSTRAINT "contact_channel_identities_linked_by_staff_id_fkey" FOREIGN KEY ("linked_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
