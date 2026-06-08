-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'WEB', 'WHATSAPP_DIRECT', 'REFERRAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('THERAPY', 'COURSE', 'WORKSHOP');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('LEAD', 'PENDING_PAYMENT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('PAYPAL', 'MERCADO_PAGO', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TherapySessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "WorkshopEditionStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'OPERATOR', 'READONLY', 'DEVELOPER');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP_LINK', 'WHATSAPP_API', 'EMAIL', 'INTERNAL');

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "phone_country_iso" CHAR(2),
    "email" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "display_name" TEXT,
    "country_iso" CHAR(2),
    "timezone" TEXT NOT NULL DEFAULT 'America/Bogota',
    "preferred_locale" TEXT NOT NULL DEFAULT 'es',
    "source" "ContactSource" NOT NULL DEFAULT 'WEB',
    "source_detail" TEXT,
    "tiktok_handle" TEXT,
    "notes" TEXT,
    "consent_data_at" TIMESTAMP(3),
    "consent_marketing_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "kind" "ProductKind" NOT NULL,
    "title" TEXT NOT NULL,
    "sessions_label" TEXT NOT NULL,
    "sessions_count" INTEGER,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_prices" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "list_amount_minor" INTEGER,
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_editions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "product_id" TEXT,
    "title" TEXT NOT NULL,
    "edition_label" TEXT,
    "card_summary" TEXT,
    "status" "WorkshopEditionStatus" NOT NULL DEFAULT 'DRAFT',
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/Bogota',
    "date_label" TEXT,
    "schedule_label" TEXT,
    "capacity" INTEGER,
    "whatsapp_template" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_editions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "workshop_edition_id" TEXT,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'LEAD',
    "label" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "parent_enrollment_id" TEXT,
    "sessions_total" INTEGER,
    "sessions_used" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3),
    "amount_minor" INTEGER,
    "external_ref" TEXT,
    "lead_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_payment_id" TEXT NOT NULL,
    "provider_order_id" TEXT,
    "status" "PaymentStatus" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "fee_minor" INTEGER,
    "net_minor" INTEGER,
    "payer_email" TEXT,
    "payer_country_iso" CHAR(2),
    "raw_payload" JSONB,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapy_packages" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "total_sessions" INTEGER NOT NULL,
    "used_sessions" INTEGER NOT NULL DEFAULT 0,
    "meet_default_url" TEXT,
    "reprogramming_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "therapy_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "therapy_sessions" (
    "id" TEXT NOT NULL,
    "therapy_package_id" TEXT NOT NULL,
    "session_number" INTEGER NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "status" "TherapySessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "meet_url" TEXT,
    "clinical_notes" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "therapy_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_users" (
    "id" TEXT NOT NULL,
    "clerk_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'OPERATOR',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "staff_user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "changes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tags" (
    "contact_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("contact_id","tag_id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "body" TEXT NOT NULL,
    "product_kind" "ProductKind",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_logs" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "template_id" TEXT,
    "staff_user_id" TEXT,
    "channel" "MessageChannel" NOT NULL DEFAULT 'WHATSAPP_LINK',
    "body_snapshot" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "event_id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_phone_e164_key" ON "contacts"("phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_email_key" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_created_at_idx" ON "contacts"("created_at");

-- CreateIndex
CREATE INDEX "contacts_country_iso_idx" ON "contacts"("country_iso");

-- CreateIndex
CREATE INDEX "product_prices_product_id_currency_idx" ON "product_prices"("product_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "workshop_editions_slug_key" ON "workshop_editions"("slug");

-- CreateIndex
CREATE INDEX "enrollments_contact_id_status_idx" ON "enrollments"("contact_id", "status");

-- CreateIndex
CREATE INDEX "enrollments_contact_id_product_id_idx" ON "enrollments"("contact_id", "product_id");

-- CreateIndex
CREATE INDEX "enrollments_status_idx" ON "enrollments"("status");

-- CreateIndex
CREATE INDEX "payments_enrollment_id_idx" ON "payments"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_payment_id_key" ON "payments"("provider", "provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "therapy_packages_enrollment_id_key" ON "therapy_packages"("enrollment_id");

-- CreateIndex
CREATE INDEX "therapy_sessions_scheduled_at_idx" ON "therapy_sessions"("scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "therapy_sessions_therapy_package_id_session_number_key" ON "therapy_sessions"("therapy_package_id", "session_number");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_clerk_user_id_key" ON "staff_users"("clerk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_key_locale_key" ON "message_templates"("key", "locale");

-- CreateIndex
CREATE INDEX "message_logs_contact_id_sent_at_idx" ON "message_logs"("contact_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events"("provider", "event_id");

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_editions" ADD CONSTRAINT "workshop_editions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_workshop_edition_id_fkey" FOREIGN KEY ("workshop_edition_id") REFERENCES "workshop_editions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_parent_enrollment_id_fkey" FOREIGN KEY ("parent_enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_packages" ADD CONSTRAINT "therapy_packages_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapy_sessions" ADD CONSTRAINT "therapy_sessions_therapy_package_id_fkey" FOREIGN KEY ("therapy_package_id") REFERENCES "therapy_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
