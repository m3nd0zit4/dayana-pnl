-- Ficha por persona de WhatsApp (armada con todo su chat, también el historial
-- importado) y lo que leyó la IA en cada respuesta. Solo añade.

-- AlterTable
ALTER TABLE "whatsapp_ai_runs" ADD COLUMN     "context" JSONB;

-- CreateTable
CREATE TABLE "whatsapp_dossiers" (
    "conversation_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "facts" JSONB NOT NULL DEFAULT '{}',
    "segment" TEXT,
    "segment_source" TEXT,
    "segment_confidence" DOUBLE PRECISION,
    "segment_reason" TEXT,
    "segment_review" BOOLEAN NOT NULL DEFAULT false,
    "segment_at" TIMESTAMP(3),
    "client_evidence" JSONB,
    "covered_through_at" TIMESTAMP(3),
    "covered_count" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_dossiers_pkey" PRIMARY KEY ("conversation_id")
);

-- CreateIndex
CREATE INDEX "whatsapp_dossiers_segment_idx" ON "whatsapp_dossiers"("segment");

-- AddForeignKey
ALTER TABLE "whatsapp_dossiers" ADD CONSTRAINT "whatsapp_dossiers_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

