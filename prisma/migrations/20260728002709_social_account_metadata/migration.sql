-- AlterTable
ALTER TABLE "social_accounts" ADD COLUMN     "last_checked_at" TIMESTAMP(3),
ADD COLUMN     "metadata" JSONB,
ALTER COLUMN "access_token_enc" DROP NOT NULL;
