-- AlterTable
ALTER TABLE "free_webinars" ADD COLUMN     "event_label" TEXT NOT NULL DEFAULT 'Webinar gratuito',
ADD COLUMN     "faq_title" TEXT,
ADD COLUMN     "link_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "link_subtitle" TEXT,
ADD COLUMN     "link_title" TEXT,
ADD COLUMN     "location_label" TEXT NOT NULL DEFAULT 'Online',
ADD COLUMN     "material_label" TEXT,
ADD COLUMN     "price_label" TEXT NOT NULL DEFAULT 'Gratis',
ADD COLUMN     "success_message" TEXT;
