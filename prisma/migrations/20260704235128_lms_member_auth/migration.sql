-- CreateEnum
CREATE TYPE "MemberAuthTokenPurpose" AS ENUM ('INVITE', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN     "paid_until" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "membership_applied_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "highlight" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tag" TEXT,
ADD COLUMN     "therapy_headline" TEXT,
ADD COLUMN     "unit_price_label" TEXT,
ADD COLUMN     "whatsapp_message" TEXT;

-- CreateTable
CREATE TABLE "member_accounts" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "password_hash" TEXT,
    "google_sub" TEXT,
    "email_verified_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_sessions" (
    "id" TEXT NOT NULL,
    "member_account_id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "device_label" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_auth_tokens" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" "MemberAuthTokenPurpose" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_modules" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body_md" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_class_sessions" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "meet_url" TEXT,
    "recording_url" TEXT,
    "recording_posted_at" TIMESTAMP(3),
    "recording_hidden_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_accounts_contact_id_key" ON "member_accounts"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_accounts_google_sub_key" ON "member_accounts"("google_sub");

-- CreateIndex
CREATE UNIQUE INDEX "member_sessions_session_token_key" ON "member_sessions"("session_token");

-- CreateIndex
CREATE INDEX "member_sessions_member_account_id_idx" ON "member_sessions"("member_account_id");

-- CreateIndex
CREATE INDEX "member_sessions_expires_at_idx" ON "member_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "member_auth_tokens_token_hash_key" ON "member_auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "member_auth_tokens_contact_id_idx" ON "member_auth_tokens"("contact_id");

-- CreateIndex
CREATE INDEX "course_modules_product_id_sort_order_idx" ON "course_modules"("product_id", "sort_order");

-- CreateIndex
CREATE INDEX "live_class_sessions_product_id_scheduled_at_idx" ON "live_class_sessions"("product_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "enrollments_paid_until_idx" ON "enrollments"("paid_until");

-- AddForeignKey
ALTER TABLE "member_accounts" ADD CONSTRAINT "member_accounts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_sessions" ADD CONSTRAINT "member_sessions_member_account_id_fkey" FOREIGN KEY ("member_account_id") REFERENCES "member_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_auth_tokens" ADD CONSTRAINT "member_auth_tokens_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_class_sessions" ADD CONSTRAINT "live_class_sessions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
