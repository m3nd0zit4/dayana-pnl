-- Intentos de cuestionario.
--
-- La fila nace al empezar el intento, no al enviarlo: el límite de tiempo se
-- mide contra `started_at` en el servidor. Un intento sin `submitted_at` está
-- en curso y se puede reanudar.

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "answers" JSONB,
    "score" INTEGER,
    "total" INTEGER,
    "passed" BOOLEAN,

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quiz_attempts_class_id_contact_id_idx" ON "quiz_attempts"("class_id", "contact_id");

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "live_class_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
