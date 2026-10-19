-- Niveles de gasto: cuántos tokens de la entrada venían de la caché de Gemini. Solo agrega.
ALTER TABLE "whatsapp_ai_runs" ADD COLUMN "cached_tokens" INTEGER;
