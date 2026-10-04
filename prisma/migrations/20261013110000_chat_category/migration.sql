-- Clasificación de los chats de WhatsApp: cliente, interesada, comunidad,
-- personal, negocio, equipo u otro. Primero reglas fijas (lo que dice el CRM y
-- patrones claros como códigos de verificación o respuestas automáticas);
-- lo que queda dudoso lo decide un modelo pequeño. Lo que marca el equipo a
-- mano (`category_source = 'manual'`) nunca se pisa. Solo añade columnas.
ALTER TABLE "conversations" ADD COLUMN "category" TEXT,
ADD COLUMN "category_source" TEXT,
ADD COLUMN "category_confidence" DOUBLE PRECISION,
ADD COLUMN "category_reason" TEXT,
ADD COLUMN "categorized_at" TIMESTAMP(3),
ADD COLUMN "categorized_through_at" TIMESTAMP(3),
ADD COLUMN "category_review" BOOLEAN NOT NULL DEFAULT false;

-- Filtros y contadores por categoría.
CREATE INDEX "conversations_channel_category_idx" ON "conversations"("channel", "category");
