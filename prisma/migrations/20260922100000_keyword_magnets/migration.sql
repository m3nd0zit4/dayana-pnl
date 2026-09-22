-- Palabras clave de redes y el material que entregan.
CREATE TABLE "keyword_magnets" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "delivery_url" TEXT NOT NULL,
    "reply_text" TEXT,
    "dm_text" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "keyword_magnets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "keyword_magnets_keyword_key" ON "keyword_magnets"("keyword");

CREATE TABLE "magnet_claims" (
    "id" TEXT NOT NULL,
    "magnet_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "source" TEXT,
    "email_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magnet_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "magnet_claims_magnet_id_email_key" ON "magnet_claims"("magnet_id", "email");
CREATE INDEX "magnet_claims_magnet_id_created_at_idx" ON "magnet_claims"("magnet_id", "created_at" DESC);

ALTER TABLE "magnet_claims" ADD CONSTRAINT "magnet_claims_magnet_id_fkey" FOREIGN KEY ("magnet_id") REFERENCES "keyword_magnets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "magnet_claims" ADD CONSTRAINT "magnet_claims_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
