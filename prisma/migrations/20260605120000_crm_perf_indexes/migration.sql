-- CreateIndex
CREATE INDEX "contacts_consent_marketing_at_idx" ON "contacts"("consent_marketing_at");

-- CreateIndex
CREATE INDEX "products_kind_idx" ON "products"("kind");

-- CreateIndex
CREATE INDEX "enrollments_updated_at_idx" ON "enrollments"("updated_at");

-- CreateIndex
CREATE INDEX "payments_status_paid_at_idx" ON "payments"("status", "paid_at");

-- CreateIndex
CREATE INDEX "contact_tags_tag_id_idx" ON "contact_tags"("tag_id");
