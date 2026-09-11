-- Retira el seguimiento de sesiones de terapia y el cuaderno clínico.
--
-- De 144 sesiones creadas nunca se agendaron 131, y el cuaderno tenía 4
-- páginas. Los PAGOS de terapia NO se tocan: viven en `payments` y
-- `enrollments`, y `enrollments.sessions_total` / `sessions_used` siguen
-- describiendo lo que la clienta compró.
--
-- Esto borra datos, y un `revert` del código no los devuelve.

-- ---------------------------------------------------------------------------
-- 1. Los cuatro eventos THERAPY_SESSION_* salen de NotificationEventType.
--
-- Postgres no sabe quitar un valor de un enum: hay que crear el tipo nuevo y
-- reapuntar cada columna que lo usa. La vez anterior que se hizo esto se
-- enumeraron las columnas de memoria y se olvidó una, así que aquí se
-- descubren solas desde el catálogo del sistema. Si aparece otra tabla con
-- este tipo, esta migración la cubre sin tener que acordarse de ella.
--
-- Las filas que llevan uno de los valores retirados se borran ANTES de
-- convertir: el cast fallaría porque ese valor ya no existe en el tipo nuevo.
-- Son avisos de sesiones que ya no se pueden abrir. Sus destinatarios caen por
-- cascada desde `platform_notifications`.
-- ---------------------------------------------------------------------------

CREATE TYPE "NotificationEventType_new" AS ENUM ('PAYMENT_APPROVED', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED', 'MANUAL_PAYMENT_RECORDED', 'PAYMENT_WEBHOOK_FAILED', 'PAYMENT_CONTACT_INCOMPLETE', 'SUBSCRIPTION_STARTED', 'SUBSCRIPTION_PAYMENT_FAILED', 'SUBSCRIPTION_CANCELLED', 'PRICE_SYNC_DRIFT', 'SUBSCRIPTION_AMOUNT_MISMATCH', 'SUBSCRIPTION_PRICE_PROPAGATION_FAILED', 'LEAD_CREATED', 'WEB_LEAD_SUBMITTED', 'ENROLLMENT_PENDING_PAYMENT', 'ENROLLMENT_ACTIVATED', 'ENROLLMENT_STATUS_CHANGED', 'CHECKOUT_ABANDONED', 'LEAD_STALE', 'DIAGNOSTIC_COMPLETED', 'DIAGNOSTIC_UNCONVERTED', 'MEMBER_SIGNED_UP', 'MEMBERSHIP_DUE_SOON', 'MEMBERSHIP_OVERDUE', 'MEMBERSHIP_EXTENDED', 'COURSE_ACCESS_GRANTED', 'LESSON_COMMENT_POSTED', 'CLASS_RECORDING_PUBLISHED', 'LOGIN_FAILED', 'LOGIN_SUCCEEDED', 'STAFF_USER_CREATED', 'AGENT_ACTION_EXECUTED', 'CAMPAIGN_COMPLETED', 'NOTIFICATION_DELIVERY_FAILED', 'SYSTEM_ALERT', 'INBOX_MESSAGE_RECEIVED', 'SOCIAL_POST_PUBLISHED', 'SOCIAL_POST_FAILED');

DO $$
DECLARE
  col record;
  retired text[] := ARRAY[
    'THERAPY_SESSION_SCHEDULED',
    'THERAPY_SESSION_RESCHEDULED',
    'THERAPY_SESSION_COMPLETED',
    'THERAPY_SESSION_NO_SHOW'
  ];
BEGIN
  FOR col IN
    SELECT c.table_schema, c.table_name, c.column_name, c.column_default
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
     AND t.table_type = 'BASE TABLE'
    WHERE c.udt_name = 'NotificationEventType'
  LOOP
    EXECUTE format(
      'DELETE FROM %I.%I WHERE %I::text = ANY($1)',
      col.table_schema, col.table_name, col.column_name
    ) USING retired;

    IF col.column_default IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT',
        col.table_schema, col.table_name, col.column_name
      );
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I TYPE "NotificationEventType_new" USING (%I::text::"NotificationEventType_new")',
      col.table_schema, col.table_name, col.column_name, col.column_name
    );

    -- El default se reescribe apuntando al tipo nuevo, que para cuando esto
    -- corre ya es el tipo de la columna.
    IF col.column_default IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT %s',
        col.table_schema, col.table_name, col.column_name,
        replace(col.column_default, '"NotificationEventType"', '"NotificationEventType_new"')
      );
    END IF;
  END LOOP;
END $$;

ALTER TYPE "NotificationEventType" RENAME TO "NotificationEventType_old";
ALTER TYPE "NotificationEventType_new" RENAME TO "NotificationEventType";
DROP TYPE "public"."NotificationEventType_old";

-- ---------------------------------------------------------------------------
-- 2. La plantilla del recordatorio de sesión.
--
-- Sus variables ({{session_date}}, {{session_time}}, {{meet_url}}) las
-- rellenaba el cron que se retiró. Dejar la fila la habría acabado enseñando
-- en Mensajes rápidos con los huecos vacíos.
-- ---------------------------------------------------------------------------

DELETE FROM "message_templates" WHERE "key" = 'session_reminder';

-- ---------------------------------------------------------------------------
-- 3. Las tablas.
-- ---------------------------------------------------------------------------

ALTER TABLE "contact_notebook_pages" DROP CONSTRAINT "contact_notebook_pages_contact_id_fkey";
ALTER TABLE "contact_notebook_pages" DROP CONSTRAINT "contact_notebook_pages_created_by_staff_id_fkey";
ALTER TABLE "contact_notebook_pages" DROP CONSTRAINT "contact_notebook_pages_enrollment_id_fkey";
ALTER TABLE "contact_notebook_pages" DROP CONSTRAINT "contact_notebook_pages_therapy_session_id_fkey";
ALTER TABLE "therapy_packages" DROP CONSTRAINT "therapy_packages_enrollment_id_fkey";
ALTER TABLE "therapy_sessions" DROP CONSTRAINT "therapy_sessions_therapy_package_id_fkey";

DROP TABLE "contact_notebook_pages";
DROP TABLE "therapy_sessions";
DROP TABLE "therapy_packages";

DROP TYPE "NotebookPageBackground";
DROP TYPE "NotebookPageKind";
DROP TYPE "TherapySessionStatus";
