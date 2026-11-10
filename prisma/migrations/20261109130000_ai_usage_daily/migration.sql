-- Uso de la IA por día y modelo, para /admin/costos (aditivo).
CREATE TABLE IF NOT EXISTS "ai_usage_daily" (
    "day" DATE NOT NULL,
    "model" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "cached_tokens" BIGINT NOT NULL DEFAULT 0,
    "audio_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_usage_daily_pkey" PRIMARY KEY ("day", "model")
);
