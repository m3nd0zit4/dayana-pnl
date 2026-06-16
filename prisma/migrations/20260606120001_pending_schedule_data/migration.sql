-- Migrate unscheduled sessions to PENDING_SCHEDULE (separate migration: enum value must commit first)
UPDATE "therapy_sessions"
SET "status" = 'PENDING_SCHEDULE'
WHERE "scheduled_at" IS NULL
  AND "status" = 'SCHEDULED'
  AND "completed_at" IS NULL;
