ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "title" TEXT;

UPDATE "message_templates" SET "title" = 'Post-pago terapia' WHERE "key" = 'post_payment_therapy' AND ("title" IS NULL OR "title" = '');
UPDATE "message_templates" SET "title" = 'Recordatorio de sesión' WHERE "key" = 'session_reminder' AND ("title" IS NULL OR "title" = '');
UPDATE "message_templates" SET "title" = 'Taller abierto' WHERE "key" = 'workshop_open' AND ("title" IS NULL OR "title" = '');
UPDATE "message_templates" SET "title" = 'Seguimiento lead' WHERE "key" = 'lead_followup' AND ("title" IS NULL OR "title" = '');

UPDATE "message_templates" SET "title" = "key" WHERE "title" IS NULL OR "title" = '';
