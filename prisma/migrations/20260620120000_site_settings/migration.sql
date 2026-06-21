-- Tasa USD→COP editable desde CRM (referencia web + Mercado Pago)
CREATE TABLE "site_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("key")
);

INSERT INTO "site_settings" ("key", "value", "updated_at")
VALUES ('usd_to_cop_rate', '3500', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
