-- «Te toca» de verdad: un chat le toca a Dayana desde que algo la necesita
-- (escalada de la IA, un mensaje que importa y que nadie va a contestar) hasta
-- que ella contesta —desde el CRM o desde el celular— o pulsa «Listo».
--
-- Antes «Te toca» era `ai_paused_reason = 'escalation'`, y solo «Listo, que
-- siga la IA» la quitaba: contestar no. En producción (2026-10-02) 21 de los 36
-- chats de «Te toca» ya los había contestado ella después de la escalada.
--
-- Aditiva: tres columnas y un índice. Repetible (IF NOT EXISTS; los UPDATE
-- dan lo mismo si se vuelven a correr). El build la aplica antes de que el
-- código nuevo sirva: lo que pase en ese rato lo pone al día
-- `scripts/whatsapp-attention-backfill.ts --apply` (los mismos UPDATE).
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "attention_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "attention_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "last_human_reply_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "conversations_channel_attention_at_idx" ON "conversations"("channel", "attention_at");

-- 1. Última respuesta humana de cada chat: lo que mandó una persona desde el
--    CRM (con su usuario), una propuesta de la IA que aprobó, o un eco del
--    celular. No cuentan la IA sola, lo que salió sin nadie detrás (p. ej. el
--    sticker que acompaña a una aprobación), lo que no se entregó, los avisos
--    grises, ni los envíos que no contestan a nadie (masivos, recordatorios,
--    evento, saludo).
UPDATE "conversations" c
SET "last_human_reply_at" = h.last_at
FROM (
  SELECT m."conversation_id", MAX(m."sent_at") AS last_at
  FROM "conversation_messages" m
  WHERE m."direction" = 'OUTBOUND'
    AND m."kind" = 'message'
    AND m."status" <> 'FAILED'
    AND (m."is_echo" OR m."staff_user_id" IS NOT NULL)
    AND (m."is_auto_reply" = false OR m."source" = 'approval')
    AND (m."source" IS NULL OR (m."source" NOT LIKE 'bulk:%' AND m."source" NOT LIKE 'recordatorio:%' AND m."source" NOT LIKE 'evento:%'))
    AND (m."client_key" IS NULL OR (m."client_key" NOT LIKE 'welcome:%' AND m."client_key" NOT LIKE 'reminder:%' AND m."client_key" NOT LIKE 'bulk:%'))
  GROUP BY m."conversation_id"
) h
WHERE h."conversation_id" = c."id"
  AND c."last_human_reply_at" IS NULL;

-- 1b. Al volver a correrla con el código nuevo ya sirviendo, solo las
--     respuestas desde el CRM o el celular la adelantan: una propuesta
--     aprobada anota hasta dónde leyó la IA (no la hora de envío), y eso ya lo
--     lleva el código.
UPDATE "conversations" c
SET "last_human_reply_at" = h.last_at
FROM (
  SELECT m."conversation_id", MAX(m."sent_at") AS last_at
  FROM "conversation_messages" m
  WHERE m."direction" = 'OUTBOUND'
    AND m."kind" = 'message'
    AND m."status" <> 'FAILED'
    AND m."is_auto_reply" = false
    AND (m."is_echo" OR m."staff_user_id" IS NOT NULL)
    AND (m."source" IS NULL OR (m."source" <> 'approval' AND m."source" NOT LIKE 'bulk:%' AND m."source" NOT LIKE 'recordatorio:%' AND m."source" NOT LIKE 'evento:%'))
    AND (m."client_key" IS NULL OR (m."client_key" NOT LIKE 'welcome:%' AND m."client_key" NOT LIKE 'reminder:%' AND m."client_key" NOT LIKE 'bulk:%'))
  GROUP BY m."conversation_id"
) h
WHERE h."conversation_id" = c."id"
  AND c."last_human_reply_at" < h.last_at;

-- 2. Escaladas de la IA que nadie contestó después: siguen en «Te toca»,
--    desde la escalada. Una pausa que puso Dayana a mano (sin categoría, o
--    «Pausado a mano.») no es una escalada: se queda como está, fuera de «Te
--    toca» (el próximo mensaje que importe la abre).
UPDATE "conversations"
SET "attention_at" = "ai_paused_at",
    "attention_reason" = "escalation_category"
WHERE "ai_paused_reason" = 'escalation'
  AND "escalation_category" IS NOT NULL
  AND NOT ("escalation_category" = 'other' AND COALESCE("escalation_reason", '') = 'Pausado a mano.')
  AND "ai_paused_at" IS NOT NULL
  AND "attention_at" IS NULL
  AND ("last_human_reply_at" IS NULL OR "last_human_reply_at" < "ai_paused_at");

-- 2b. Escaladas que Dayana contestó, pero la persona volvió a escribir
--     después de su respuesta: le toca otra vez («sin responder», desde ese
--     mensaje). Un «gracias» o un sticker solos no cuentan.
UPDATE "conversations" c
SET "attention_at" = n.first_at,
    "attention_reason" = 'unanswered'
FROM (
  SELECT c2."id", MIN(m."sent_at") AS first_at
  FROM "conversations" c2
  JOIN "conversation_messages" m ON m."conversation_id" = c2."id"
  WHERE c2."ai_paused_reason" = 'escalation'
    AND c2."escalation_category" IS NOT NULL
    AND NOT (c2."escalation_category" = 'other' AND COALESCE(c2."escalation_reason", '') = 'Pausado a mano.')
    AND c2."attention_at" IS NULL
    AND c2."ai_paused_at" IS NOT NULL
    AND c2."last_human_reply_at" IS NOT NULL
    AND c2."last_human_reply_at" >= c2."ai_paused_at"
    AND m."direction" = 'INBOUND'
    AND m."kind" = 'message'
    AND m."sent_at" > c2."last_human_reply_at"
    AND NOT (COALESCE(m."body", '') ~* '^[^[:alnum:]]*((muchas|muchísimas|mil)[[:space:]]+)?(gracias|grax|amén|amen|bendiciones|igualmente)[^[:alnum:]]*$')
    AND NOT (COALESCE(m."body", '') = '' AND COALESCE(m."attachments" @> '[{"kind":"sticker"}]'::jsonb, false))
  GROUP BY c2."id"
) n
WHERE n."id" = c."id";

-- 3. Escaladas de la IA que Dayana ya contestó y no son delicadas: quedan
--    como cualquier respuesta suya (pausa humana; la IA vuelve pasadas las
--    horas de relevo, contadas desde hoy). Lo clínico, los pagos y lo urgente
--    siguen apartados de la IA hasta que ella pulse «Listo»; una pausa a mano
--    se queda como está.
UPDATE "conversations"
SET "ai_paused_reason" = 'human',
    "ai_paused_at" = (now() AT TIME ZONE 'UTC')
WHERE "ai_paused_reason" = 'escalation'
  AND "escalation_category" IS NOT NULL
  AND NOT ("escalation_category" = 'other' AND COALESCE("escalation_reason", '') = 'Pausado a mano.')
  AND "ai_paused_at" IS NOT NULL
  AND "last_human_reply_at" IS NOT NULL
  AND "last_human_reply_at" >= "ai_paused_at"
  AND "escalation_category" NOT IN ('clinical', 'payment')
  AND COALESCE("escalation_severity", '') <> 'urgent';

-- 4. Lo que quedó en «Te toca» y ella contestó mientras el código viejo
--    seguía sirviendo (el rato del despliegue): sale. Solo en pausa humana:
--    una escalada delicada abierta espera a «Listo».
UPDATE "conversations"
SET "attention_at" = NULL,
    "attention_reason" = NULL
WHERE "ai_paused_reason" = 'human'
  AND "attention_at" IS NOT NULL
  AND "last_human_reply_at" IS NOT NULL
  AND "last_human_reply_at" >= "attention_at";
