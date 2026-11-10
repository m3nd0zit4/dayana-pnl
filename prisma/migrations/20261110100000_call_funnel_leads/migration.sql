-- El embudo de la llamada gratis en la web (`/llamada`). Aditivo: una tabla nueva.
CREATE TABLE IF NOT EXISTS "call_funnel_leads" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "first_name" TEXT NOT NULL,
    "timezone" TEXT,
    "country_iso" CHAR(2),
    "answers" JSONB,
    "answered_at" TIMESTAMP(3),
    "booking_id" TEXT,
    "booked_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "confirm_click_at" TIMESTAMP(3),
    "booked_ip_hash" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "utm_term" TEXT,
    "fbclid" TEXT,
    "ttclid" TEXT,
    "gclid" TEXT,
    "ref" TEXT,
    "referrer" TEXT,
    "landing_path" TEXT,
    "follow_up" TEXT NOT NULL DEFAULT 'nuevo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_funnel_leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "call_funnel_leads_token_key" ON "call_funnel_leads"("token");
CREATE INDEX IF NOT EXISTS "call_funnel_leads_contact_id_created_at_idx" ON "call_funnel_leads"("contact_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "call_funnel_leads_created_at_idx" ON "call_funnel_leads"("created_at" DESC);
CREATE INDEX IF NOT EXISTS "call_funnel_leads_booking_id_idx" ON "call_funnel_leads"("booking_id");
CREATE INDEX IF NOT EXISTS "call_funnel_leads_booked_ip_hash_booked_at_idx" ON "call_funnel_leads"("booked_ip_hash", "booked_at");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_funnel_leads_contact_id_fkey') THEN
        ALTER TABLE "call_funnel_leads"
            ADD CONSTRAINT "call_funnel_leads_contact_id_fkey"
            FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
