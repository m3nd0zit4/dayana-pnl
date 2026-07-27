-- CreateEnum
CREATE TYPE "SocialProvider" AS ENUM ('TIKTOK', 'INSTAGRAM', 'FACEBOOK');

-- CreateEnum
CREATE TYPE "SocialMediaType" AS ENUM ('VIDEO', 'PHOTO');

-- CreateEnum
CREATE TYPE "SocialPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELED');

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" TEXT NOT NULL,
    "provider" "SocialProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "display_name" TEXT,
    "username" TEXT,
    "avatar_url" TEXT,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT,
    "expires_at" TIMESTAMP(3),
    "refresh_expires_at" TIMESTAMP(3),
    "scopes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_error" TEXT,
    "connected_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "media_type" "SocialMediaType" NOT NULL DEFAULT 'VIDEO',
    "status" "SocialPostStatus" NOT NULL DEFAULT 'DRAFT',
    "caption" TEXT,
    "media_urls" JSONB NOT NULL,
    "privacy_level" TEXT NOT NULL DEFAULT 'SELF_ONLY',
    "disable_comment" BOOLEAN NOT NULL DEFAULT false,
    "disable_duet" BOOLEAN NOT NULL DEFAULT false,
    "disable_stitch" BOOLEAN NOT NULL DEFAULT false,
    "scheduled_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "external_publish_id" TEXT,
    "external_post_id" TEXT,
    "post_url" TEXT,
    "failed_reason" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_provider_external_id_key" ON "social_accounts"("provider", "external_id");

-- CreateIndex
CREATE INDEX "social_posts_status_scheduled_at_idx" ON "social_posts"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "social_posts_account_id_created_at_idx" ON "social_posts"("account_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connected_by_staff_id_fkey" FOREIGN KEY ("connected_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
