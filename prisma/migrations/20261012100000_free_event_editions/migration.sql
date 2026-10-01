-- Eventos gratuitos como ediciones (igual que los talleres): estado propio,
-- URLs anteriores, fecha de publicación, historia, envíos de WhatsApp ligados
-- al evento y la confirmación por WhatsApp al inscribirse. Solo añade.

-- CreateEnum
CREATE TYPE "FreeEventStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'COMPLETED');

-- AlterTable
ALTER TABLE "free_webinars" ADD COLUMN     "previous_slugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "status" "FreeEventStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "wa_confirmation_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "webinar_registrations" ADD COLUMN     "confirmation_wa_error" TEXT,
ADD COLUMN     "confirmation_wa_sent_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "whatsapp_sends" ADD COLUMN     "free_webinar_id" TEXT,
ADD COLUMN     "workshop_edition_id" TEXT;

-- CreateTable
CREATE TABLE "free_event_activities" (
    "id" TEXT NOT NULL,
    "free_webinar_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER,
    "failed" INTEGER,
    "staff_user_id" TEXT,
    "whatsapp_send_id" TEXT,
    "meta" JSONB,

    CONSTRAINT "free_event_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "free_event_activities_free_webinar_id_at_idx" ON "free_event_activities"("free_webinar_id", "at");

-- CreateIndex
CREATE INDEX "free_webinars_status_starts_at_idx" ON "free_webinars"("status", "starts_at");

-- CreateIndex
CREATE INDEX "whatsapp_sends_free_webinar_id_idx" ON "whatsapp_sends"("free_webinar_id");

-- CreateIndex
CREATE INDEX "whatsapp_sends_workshop_edition_id_idx" ON "whatsapp_sends"("workshop_edition_id");

-- AddForeignKey
ALTER TABLE "free_event_activities" ADD CONSTRAINT "free_event_activities_free_webinar_id_fkey" FOREIGN KEY ("free_webinar_id") REFERENCES "free_webinars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sends" ADD CONSTRAINT "whatsapp_sends_free_webinar_id_fkey" FOREIGN KEY ("free_webinar_id") REFERENCES "free_webinars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sends" ADD CONSTRAINT "whatsapp_sends_workshop_edition_id_fkey" FOREIGN KEY ("workshop_edition_id") REFERENCES "workshop_editions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------

-- 1. Estado. Terminado = archivado, renombrado (`gratuito-<id>`) o cerrado por
--    el reloj; si no, publicado o borrador según el interruptor de siempre.
UPDATE "free_webinars"
SET "status" = (CASE
  WHEN "archived_at" IS NOT NULL OR "slug" <> 'gratuito' OR "ended_at" IS NOT NULL THEN 'COMPLETED'
  WHEN "is_active" THEN 'OPEN'
  ELSE 'DRAFT'
END)::"FreeEventStatus";

-- 2. Fecha de publicación (aproximada): el primer guardado con la página
--    encendida que quede en la auditoría; si no hay, la creación (o la fecha
--    del evento, si la fila se creó después — la edición separada de agosto).
UPDATE "free_webinars" w
SET "published_at" = COALESCE(
  (
    SELECT min(a."created_at") FROM "audit_logs" a
    WHERE a."entity_type" = 'FreeWebinar' AND a."entity_id" = w."id"
      AND a."changes"->>'isActive' = 'true'
  ),
  LEAST(w."created_at", COALESCE(w."starts_at", w."created_at"))
)
WHERE w."status" IN ('OPEN', 'COMPLETED');

-- 3. `is_active` es el espejo de OPEN. Solo cambia la fila ya terminada que
--    seguía con el interruptor encendido: el cierre del reloj no lo tocaba.
UPDATE "free_webinars"
SET "is_active" = ("status" = 'OPEN')
WHERE "is_active" IS DISTINCT FROM ("status" = 'OPEN');

-- 4. URL legible para las ediciones archivadas por renombre (`gratuito-<id>`):
--    «<titular>-<fecha>», y la vieja a `previous_slugs`. La fila `gratuito` NO
--    se toca: el código anterior la busca por ese slug, así que revertir el
--    despliegue sigue sirviendo la landing. La renombra el código nuevo la
--    primera vez que se publica un evento.
WITH base AS (
  SELECT
    "id",
    "slug" AS old_slug,
    trim(BOTH '-' FROM regexp_replace(
      translate(lower("headline"), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
      '[^a-z0-9]+', '-', 'g'
    )) AS h,
    to_char(("starts_at" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS d
  FROM "free_webinars"
  WHERE "slug" LIKE 'gratuito-%'
),
named AS (
  SELECT
    "id",
    old_slug,
    COALESCE(NULLIF(concat_ws('-',
      NULLIF(CASE WHEN length(h) > 40 THEN regexp_replace(left(h, 41), '-[^-]*$', '') ELSE h END, ''),
      d
    ), ''), 'evento') AS s
  FROM base
),
ranked AS (
  SELECT "id", old_slug, s, row_number() OVER (PARTITION BY s ORDER BY "id") AS rn
  FROM named
)
UPDATE "free_webinars" w
SET
  "slug" = CASE
    WHEN r.rn = 1 AND NOT EXISTS (SELECT 1 FROM "free_webinars" o WHERE o."slug" = r.s) THEN r.s
    ELSE r.s || '-' || right(w."id", 6)
  END,
  "previous_slugs" = array_append(COALESCE(w."previous_slugs", ARRAY[]::TEXT[]), r.old_slug)
FROM ranked r
WHERE r."id" = w."id";

-- 5. Historia: lo que se puede reconstruir. Ids deterministas (`bf-…`) para
--    que el relleno no se duplique si se vuelve a ejecutar a mano. «Creado»
--    nunca después de «publicado»: la fila de agosto se creó al separarla.
INSERT INTO "free_event_activities" ("id", "free_webinar_id", "kind", "at", "meta")
SELECT 'bf-created-' || "id", "id", 'created', LEAST("created_at", COALESCE("published_at", "created_at")),
  '{"backfill": true}'::jsonb
FROM "free_webinars"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "free_event_activities" ("id", "free_webinar_id", "kind", "at", "meta")
SELECT 'bf-published-' || "id", "id", 'published', "published_at", '{"backfill": true, "approximate": true}'::jsonb
FROM "free_webinars" WHERE "published_at" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "free_event_activities" ("id", "free_webinar_id", "kind", "at", "meta")
SELECT 'bf-ended-' || "id", "id", 'ended', "ended_at", '{"backfill": true}'::jsonb
FROM "free_webinars" WHERE "ended_at" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "free_event_activities" ("id", "free_webinar_id", "kind", "at", "meta")
SELECT 'bf-archived-' || "id", "id", 'archived', "archived_at", '{"backfill": true}'::jsonb
FROM "free_webinars" WHERE "archived_at" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

-- Desde la auditoría del panel (solo filas que todavía existen).
INSERT INTO "free_event_activities" ("id", "free_webinar_id", "kind", "at", "staff_user_id", "meta")
SELECT 'bf-audit-' || a."id" || '-meet', a."entity_id", 'meet_link_changed', a."created_at", a."staff_user_id",
  '{"backfill": true}'::jsonb
FROM "audit_logs" a JOIN "free_webinars" w ON w."id" = a."entity_id"
WHERE a."entity_type" = 'FreeWebinar' AND a."changes"->>'meetUrlChanged' = 'true'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "free_event_activities" ("id", "free_webinar_id", "kind", "at", "staff_user_id", "meta")
SELECT 'bf-audit-' || a."id" || '-date', a."entity_id", 'date_changed', a."created_at", a."staff_user_id",
  jsonb_build_object('backfill', true, 'startsAtIso', a."changes"->>'startsAtIso')
FROM "audit_logs" a JOIN "free_webinars" w ON w."id" = a."entity_id"
WHERE a."entity_type" = 'FreeWebinar' AND a."changes"->>'startsAtChanged' = 'true'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "free_event_activities" ("id", "free_webinar_id", "kind", "at", "staff_user_id", "meta")
SELECT 'bf-audit-' || a."id" || '-reopen', a."entity_id", 'reopened', a."created_at", a."staff_user_id",
  '{"backfill": true}'::jsonb
FROM "audit_logs" a JOIN "free_webinars" w ON w."id" = a."entity_id"
WHERE a."entity_type" = 'FreeWebinar' AND a."changes"->>'ended' = 'false'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "free_event_activities" ("id", "free_webinar_id", "kind", "at", "staff_user_id", "meta")
SELECT 'bf-audit-' || a."id" || '-material', a."entity_id", 'material_uploaded', a."created_at", a."staff_user_id",
  jsonb_build_object('backfill', true, 'fileName', a."changes"->>'material')
FROM "audit_logs" a JOIN "free_webinars" w ON w."id" = a."entity_id"
WHERE a."entity_type" = 'FreeWebinar' AND a."changes" ? 'material' AND a."changes"->>'material' IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

-- Reenvíos manuales de correo (pendientes o a todas) con su resultado.
INSERT INTO "free_event_activities" ("id", "free_webinar_id", "kind", "at", "count", "failed", "staff_user_id", "meta")
SELECT 'bf-audit-' || a."id" || '-resend', a."entity_id",
  CASE a."changes"->>'pass' WHEN '24h' THEN 'reminder_24h_email' WHEN '1h' THEN 'reminder_1h_email' ELSE 'link_emails' END,
  a."created_at",
  CASE WHEN a."changes"->'result'->>'sent' ~ '^\d+$' THEN (a."changes"->'result'->>'sent')::int END,
  CASE WHEN a."changes"->'result'->>'failed' ~ '^\d+$' THEN (a."changes"->'result'->>'failed')::int END,
  a."staff_user_id",
  jsonb_build_object('backfill', true, 'manual', true, 'scope', a."changes"->>'resend')
FROM "audit_logs" a JOIN "free_webinars" w ON w."id" = a."entity_id"
WHERE a."entity_type" = 'FreeWebinar' AND a."changes"->>'resend' IN ('pending', 'all')
ON CONFLICT ("id") DO NOTHING;

-- Recordatorios por WhatsApp enviados a mano.
INSERT INTO "free_event_activities" ("id", "free_webinar_id", "kind", "at", "count", "failed", "staff_user_id", "meta")
SELECT 'bf-audit-' || a."id" || '-wa', a."entity_id",
  CASE a."changes"->>'pass' WHEN '1h' THEN 'reminder_1h_wa' ELSE 'reminder_24h_wa' END,
  a."created_at",
  CASE WHEN a."changes"->'result'->>'sent' ~ '^\d+$' THEN (a."changes"->'result'->>'sent')::int END,
  (CASE WHEN a."changes"->'result'->>'failed' ~ '^\d+$' THEN (a."changes"->'result'->>'failed')::int ELSE 0 END)
    + (CASE WHEN a."changes"->'result'->>'skipped' ~ '^\d+$' THEN (a."changes"->'result'->>'skipped')::int ELSE 0 END),
  a."staff_user_id",
  '{"backfill": true, "manual": true}'::jsonb
FROM "audit_logs" a JOIN "free_webinars" w ON w."id" = a."entity_id"
WHERE a."entity_type" = 'FreeWebinar' AND a."action" = 'WHATSAPP_SENT'
  AND a."changes"->>'source' = 'evento:recordatorio'
ON CONFLICT ("id") DO NOTHING;

-- 6. Envíos de WhatsApp → su evento o taller (aproximado).
--    Evento: solo los hechos desde un evento concreto («Evento: …»; los de
--    «Inscritas de todos los eventos» quedan sueltos). Van al primer evento
--    que todavía no había terminado (fecha + 3 h) al enviarse, prefiriendo el
--    que coincide en titular; los de material o grabación, al último evento
--    que ya había empezado. No se usa la fecha de creación del evento: la
--    edición de agosto se separó después y su fila es más nueva que sus envíos.
UPDATE "whatsapp_sends" s
SET "free_webinar_id" = COALESCE(
  CASE WHEN s."title" ILIKE '%material%' OR s."title" ILIKE '%grabaci%' THEN (
    SELECT w."id" FROM "free_webinars" w
    WHERE w."starts_at" IS NOT NULL AND w."starts_at" <= s."created_at"
    ORDER BY (position(lower(w."headline") IN lower(s."title")) > 0) DESC, w."starts_at" DESC
    LIMIT 1
  ) END,
  (
    SELECT w."id" FROM "free_webinars" w
    WHERE w."starts_at" IS NOT NULL AND w."starts_at" + interval '3 hours' >= s."created_at"
    ORDER BY (position(lower(w."headline") IN lower(s."title")) > 0) DESC, w."starts_at" ASC
    LIMIT 1
  )
)
WHERE s."kind" = 'evento' AND s."free_webinar_id" IS NULL AND s."title" LIKE 'Evento:%';

--    Taller: por el título («Taller: <título>…»), el más largo que coincida; si
--    hay varias ediciones con el mismo título, la que aún no había pasado.
UPDATE "whatsapp_sends" s
SET "workshop_edition_id" = (
  SELECT e."id" FROM "workshop_editions" e
  WHERE left(s."title", length('Taller: ' || e."title")) = 'Taller: ' || e."title"
  ORDER BY length(e."title") DESC,
    (e."starts_at" IS NOT NULL AND e."starts_at" + interval '1 day' >= s."created_at") DESC,
    e."starts_at" ASC NULLS LAST,
    e."created_at" DESC
  LIMIT 1
)
WHERE s."kind" = 'taller' AND s."workshop_edition_id" IS NULL;
