-- Replace Clerk id with password hash for staff CRM login
ALTER TABLE "staff_users" DROP COLUMN IF EXISTS "clerk_user_id";
ALTER TABLE "staff_users" ADD COLUMN IF NOT EXISTS "password_hash" TEXT;
-- Backfill placeholder; run db:seed or set passwords before enforcing NOT NULL
UPDATE "staff_users" SET "password_hash" = '' WHERE "password_hash" IS NULL;
ALTER TABLE "staff_users" ALTER COLUMN "password_hash" SET NOT NULL;
