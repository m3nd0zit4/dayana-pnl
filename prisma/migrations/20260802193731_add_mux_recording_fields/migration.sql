-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('NONE', 'UPLOADING', 'PROCESSING', 'READY', 'ERRORED');

-- AlterTable
ALTER TABLE "live_class_sessions" ADD COLUMN     "mux_asset_id" TEXT,
ADD COLUMN     "mux_playback_id" TEXT,
ADD COLUMN     "mux_upload_id" TEXT,
ADD COLUMN     "recording_duration_sec" INTEGER,
ADD COLUMN     "recording_error_message" TEXT,
ADD COLUMN     "recording_status" "RecordingStatus" NOT NULL DEFAULT 'NONE';
