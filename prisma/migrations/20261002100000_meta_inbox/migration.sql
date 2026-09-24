-- Cola durable de entrada de WhatsApp/Meta: nada se pierde si el procesamiento falla.
CREATE TABLE "meta_webhook_payloads" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB NOT NULL,
    CONSTRAINT "meta_webhook_payloads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "meta_webhook_payloads_received_at_idx" ON "meta_webhook_payloads"("received_at");

CREATE TABLE "meta_inbox_events" (
    "id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "wamid" TEXT,
    "object" TEXT NOT NULL,
    "payload_id" TEXT,
    "normalized" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMP(3),
    "last_error" TEXT,
    "outcome" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    CONSTRAINT "meta_inbox_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "meta_inbox_events_dedupe_key_key" ON "meta_inbox_events"("dedupe_key");
CREATE INDEX "meta_inbox_events_state_next_attempt_at_idx" ON "meta_inbox_events"("state", "next_attempt_at");
CREATE INDEX "meta_inbox_events_wamid_idx" ON "meta_inbox_events"("wamid");
CREATE INDEX "meta_inbox_events_received_at_idx" ON "meta_inbox_events"("received_at");
ALTER TABLE "meta_inbox_events" ADD CONSTRAINT "meta_inbox_events_payload_id_fkey" FOREIGN KEY ("payload_id") REFERENCES "meta_webhook_payloads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
