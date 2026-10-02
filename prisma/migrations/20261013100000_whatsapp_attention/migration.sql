-- «Te toca» de verdad: un chat le toca a Dayana desde que algo la necesita
-- (escalada de la IA, un mensaje que importa y que nadie va a contestar) hasta
-- que ella contesta —desde el CRM o desde el celular— o pulsa «Listo».
--
-- Antes «Te toca» era `ai_paused_reason = 'escalation'`, y solo «Listo, que
-- siga la IA» la quitaba: contestar no. En producción (2026-10-02) 21 de los 36
-- chats de «Te toca» ya los había contestado ella después de la escalada.
--
-- Aditiva: tres columnas y un índice. Repetible (IF NOT EXISTS; los UPDATE
-- dan lo mismo si se vuelven a correr).
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "attention_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "attention_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "last_human_reply_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "conversations_channel_attention_at_idx" ON "conversations"("channel", "attention_at");

-- 1. Última respuesta humana de cada chat: lo que mandó una persona desde el
--    CRM, una propuesta de la IA que aprobó, o un eco del celular. No cuentan
--    la IA sola, lo que no se entregó, los avisos grises, ni los envíos que no
--    contestan a nadie (masivos, recordatorios, evento, saludo).
UPDATE "conversations" c
SET "last_human_reply_at" = h.last_at
FROM (
  SELECT m."conversation_id", MAX(m."sent_at") AS last_at
  FROM "conversation_messages" m
  WHERE m."direction" = 'OUTBOUND'
    AND m."kind" = 'message'
    AND m."status" <> 'FAILED'
    AND (m."is_auto_reply" = false OR m."source" = 'approval')
    AND (m."source" IS NULL OR (m."source" NOT LIKE 'bulk:%' AND m."source" NOT LIKE 'recordatorio:%' AND m."source" NOT LIKE 'evento:%'))
    AND (m."client_key" IS NULL OR (m."client_key" NOT LIKE 'welcome:%' AND m."client_key" NOT LIKE 'reminder:%' AND m."client_key" NOT LIKE 'bulk:%'))
  GROUP BY m."conversation_id"
) h
WHERE h."conversation_id" = c."id"
  AND (c."last_human_reply_at" IS NULL OR c."last_human_reply_at" < h.last_at);

-- 2. Escaladas que nadie contestó después: siguen en «Te toca», desde la escalada.
UPDATE "conversations"
SET "attention_at" = "ai_paused_at",
    "attention_reason" = COALESCE("escalation_category", 'other')
WHERE "ai_paused_reason" = 'escalation'
  AND "ai_paused_at" IS NOT NULL
  AND "attention_at" IS NULL
  AND ("last_human_reply_at" IS NULL OR "last_human_reply_at" < "ai_paused_at");

-- 3. Escaladas que Dayana ya contestó: salen de «Te toca» y quedan como
--    cualquier respuesta suya (la IA vuelve pasadas las horas de relevo).
UPDATE "conversations"
SET "ai_paused_reason" = 'human'
WHERE "ai_paused_reason" = 'escalation'
  AND "ai_paused_at" IS NOT NULL
  AND "last_human_reply_at" IS NOT NULL
  AND "last_human_reply_at" >= "ai_paused_at";
