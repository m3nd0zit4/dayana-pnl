-- Talleres: si la fecha lleva hora se guarda, como en los eventos, en vez de
-- deducirlo de las 12:00 (un taller de verdad a mediodía se leía como «solo
-- el día»). Y el error del recordatorio de 1 h por WhatsApp aparte del de
-- 24 h, para que un 1 h que sale no tape un 24 h que falló. Solo añade.

-- AlterTable
ALTER TABLE "workshop_editions" ADD COLUMN     "starts_at_has_time" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN     "workshop_wa_reminder_1h_error" TEXT;

-- Relleno con la regla que había: sin fecha, o a las 12:00 en su zona (el
-- ancla de «solo el día») salvo que el cronograma empiece de verdad a esa hora.
-- Una zona que Postgres no conoce no tumba la migración: se lee en Bogotá.
UPDATE "workshop_editions" e
SET "starts_at_has_time" = false
WHERE e."starts_at" IS NULL
   OR (
     to_char(
       (e."starts_at" AT TIME ZONE 'UTC') AT TIME ZONE COALESCE(
         (SELECT z."name" FROM pg_timezone_names z WHERE z."name" = e."timezone" LIMIT 1),
         'America/Bogota'
       ),
       'HH24:MI'
     ) = '12:00'
     AND COALESCE(
       CASE WHEN jsonb_typeof(e."day_schedule") = 'array' THEN e."day_schedule"->0->>'startTime' END,
       ''
     ) <> '12:00'
   );
