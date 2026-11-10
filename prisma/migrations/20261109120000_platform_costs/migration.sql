-- Facturas y suscripciones de la plataforma, para /admin/costos (aditivo).
CREATE TABLE IF NOT EXISTS "platform_costs" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'MONTHLY',
    "currency" CHAR(3) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_costs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "platform_costs_starts_on_idx" ON "platform_costs"("starts_on");
