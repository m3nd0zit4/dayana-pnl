-- CreateEnum
CREATE TYPE "PromoDiscountType" AS ENUM ('PERCENT', 'FIXED_AMOUNT');

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discount_type" "PromoDiscountType" NOT NULL,
    "percent_off" INTEGER,
    "amount_off_usd_minor" INTEGER,
    "amount_off_cop_minor" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "max_redemptions" INTEGER,
    "times_redeemed" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code_redemptions" (
    "id" TEXT NOT NULL,
    "promo_code_id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "discount_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_code_redemptions_enrollment_id_key" ON "promo_code_redemptions"("enrollment_id");

-- CreateIndex
CREATE INDEX "promo_code_redemptions_promo_code_id_idx" ON "promo_code_redemptions"("promo_code_id");

-- AddForeignKey
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
