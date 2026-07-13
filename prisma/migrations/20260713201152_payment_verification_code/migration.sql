-- CreateTable
CREATE TABLE "payment_verification_codes" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "enrollment_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_verification_codes_staff_user_id_idx" ON "payment_verification_codes"("staff_user_id");

-- AddForeignKey
ALTER TABLE "payment_verification_codes" ADD CONSTRAINT "payment_verification_codes_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_verification_codes" ADD CONSTRAINT "payment_verification_codes_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
