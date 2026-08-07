-- Free webinar: Meet link + Mux promo video + per-registrant email state.

-- AlterTable
ALTER TABLE "free_webinars"
  ADD COLUMN "meet_url" TEXT,
  ADD COLUMN "mux_upload_id" TEXT,
  ADD COLUMN "mux_asset_id" TEXT,
  ADD COLUMN "mux_playback_id" TEXT,
  ADD COLUMN "video_status" "RecordingStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "video_duration_sec" INTEGER,
  ADD COLUMN "video_error_message" TEXT;

-- CreateTable
CREATE TABLE "webinar_registrations" (
    "id" TEXT NOT NULL,
    "webinar_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "link_email_sent_at" TIMESTAMP(3),
    "reminder_24h_sent_at" TIMESTAMP(3),
    "reminder_1h_sent_at" TIMESTAMP(3),

    CONSTRAINT "webinar_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webinar_registrations_webinar_id_contact_id_key" ON "webinar_registrations"("webinar_id", "contact_id");

-- AddForeignKey
ALTER TABLE "webinar_registrations" ADD CONSTRAINT "webinar_registrations_webinar_id_fkey" FOREIGN KEY ("webinar_id") REFERENCES "free_webinars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_registrations" ADD CONSTRAINT "webinar_registrations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: contacts already carrying the `webinar-gratuito` tag registered
-- before this table existed. Without this they would silently receive neither
-- the Meet link nor the reminders. All *_sent_at stay NULL, so they are picked
-- up by the first link fan-out.
INSERT INTO "webinar_registrations" ("id", "webinar_id", "contact_id", "created_at")
SELECT replace(gen_random_uuid()::text, '-', ''), w."id", ct."contact_id", ct."created_at"
FROM "contact_tags" ct
JOIN "tags" t ON t."id" = ct."tag_id"
CROSS JOIN "free_webinars" w
WHERE t."slug" = 'webinar-gratuito' AND w."slug" = 'gratuito'
ON CONFLICT ("webinar_id", "contact_id") DO NOTHING;
