-- «La IA responde siempre» en un chat (lo enciende Dayana). Solo agrega columnas.
ALTER TABLE "conversations" ADD COLUMN "ai_always_at" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN "ai_always_by_id" TEXT;
