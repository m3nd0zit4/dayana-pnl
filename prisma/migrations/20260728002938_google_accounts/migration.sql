-- CreateEnum
CREATE TYPE "GoogleService" AS ENUM ('CALENDAR', 'CONTACTS', 'DRIVE');

-- AlterTable
ALTER TABLE "therapy_sessions" ADD COLUMN     "google_event_id" TEXT;

-- CreateTable
CREATE TABLE "google_accounts" (
    "id" TEXT NOT NULL,
    "connect_subject" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "services" "GoogleService"[],
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "last_error" TEXT,
    "connected_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_accounts_connect_subject_key" ON "google_accounts"("connect_subject");

-- CreateIndex
CREATE INDEX "google_accounts_is_active_created_at_idx" ON "google_accounts"("is_active", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_connected_by_staff_id_fkey" FOREIGN KEY ("connected_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
