-- Talleres con el mismo ciclo que los eventos gratuitos: fecha de publicación,
-- cierre sellado (a mano o por el reloj), historia propia y recordatorios por
-- WhatsApp con su sello en la matrícula. Solo añade.

-- AlterTable
ALTER TABLE "workshop_editions" ADD COLUMN     "ended_at" TIMESTAMP(3),
ADD COLUMN     "published_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN     "workshop_reminder_1h_wa_sent_at" TIMESTAMP(3),
ADD COLUMN     "workshop_reminder_24h_wa_sent_at" TIMESTAMP(3),
ADD COLUMN     "workshop_wa_reminder_error" TEXT,
ADD COLUMN     "workshop_wa_reminder_error_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "workshop_edition_activities" (
    "id" TEXT NOT NULL,
    "workshop_edition_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER,
    "failed" INTEGER,
    "staff_user_id" TEXT,
    "whatsapp_send_id" TEXT,
    "meta" JSONB,

    CONSTRAINT "workshop_edition_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workshop_edition_activities_workshop_edition_id_at_idx" ON "workshop_edition_activities"("workshop_edition_id", "at");

-- AddForeignKey
ALTER TABLE "workshop_edition_activities" ADD CONSTRAINT "workshop_edition_activities_workshop_edition_id_fkey" FOREIGN KEY ("workshop_edition_id") REFERENCES "workshop_editions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------

-- 1. Publicada: toda edición que alguna vez estuvo a la vista (abierta,
--    cerrada o realizada). No hay registro de cuándo: la creación.
UPDATE "workshop_editions"
SET "published_at" = "created_at"
WHERE "status" IN ('OPEN', 'CLOSED', 'COMPLETED') AND "published_at" IS NULL;

-- 2. Terminada: las realizadas. Cuando acabó si se sabe; si no, la fecha más
--    3 h (lo mismo que hace el reloj); si tampoco, el último guardado.
UPDATE "workshop_editions"
SET "ended_at" = COALESCE("ends_at", "starts_at" + interval '3 hours', "updated_at")
WHERE "status" = 'COMPLETED' AND "ended_at" IS NULL;

-- 3. Historia: lo que se puede reconstruir, con ids deterministas (`bf-…`)
--    para que el relleno no se duplique si se vuelve a ejecutar a mano.
INSERT INTO "workshop_edition_activities" ("id", "workshop_edition_id", "kind", "at", "meta")
SELECT 'bf-created-' || "id", "id", 'created', "created_at", '{"backfill": true}'::jsonb
FROM "workshop_editions"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "workshop_edition_activities" ("id", "workshop_edition_id", "kind", "at", "meta")
SELECT 'bf-published-' || "id", "id", 'published', "published_at", '{"backfill": true, "approximate": true}'::jsonb
FROM "workshop_editions" WHERE "published_at" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "workshop_edition_activities" ("id", "workshop_edition_id", "kind", "at", "meta")
SELECT 'bf-ended-' || "id", "id", 'ended', "ended_at", '{"backfill": true, "approximate": true}'::jsonb
FROM "workshop_editions" WHERE "ended_at" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
