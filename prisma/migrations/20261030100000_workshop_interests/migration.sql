-- Interesadas en un taller: quien preguntó por él por WhatsApp, para el seguimiento de Dayana. Solo agrega.
CREATE TABLE IF NOT EXISTS "workshop_interests" (
    "id" TEXT NOT NULL,
    "edition_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "first_message" TEXT NOT NULL,
    "first_asked_at" TIMESTAMP(3) NOT NULL,
    "last_asked_at" TIMESTAMP(3) NOT NULL,
    "asks" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'nuevo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_interests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "workshop_interests_edition_id_conversation_id_key" ON "workshop_interests"("edition_id", "conversation_id");
CREATE INDEX IF NOT EXISTS "workshop_interests_edition_id_last_asked_at_idx" ON "workshop_interests"("edition_id", "last_asked_at");

DO $$ BEGIN
  ALTER TABLE "workshop_interests" ADD CONSTRAINT "workshop_interests_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "workshop_editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "workshop_interests" ADD CONSTRAINT "workshop_interests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
