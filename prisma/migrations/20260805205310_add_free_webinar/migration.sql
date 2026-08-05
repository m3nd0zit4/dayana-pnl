-- CreateTable
CREATE TABLE "free_webinars" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT 'gratuito',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "headline" TEXT NOT NULL,
    "subheadline" TEXT,
    "body" TEXT,
    "date_label" TEXT,
    "time_label" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Bogota',
    "learn_items" JSONB NOT NULL,
    "faq" JSONB,
    "cta_label" TEXT NOT NULL DEFAULT 'Registrarme gratis',
    "form_title" TEXT NOT NULL DEFAULT 'Reserva tu lugar',
    "meta_title" TEXT,
    "meta_description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "free_webinars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "free_webinars_slug_key" ON "free_webinars"("slug");
