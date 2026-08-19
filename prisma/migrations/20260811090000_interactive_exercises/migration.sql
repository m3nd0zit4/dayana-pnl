-- Ejercicios interactivos.
--
-- El ejercicio deja de ser una lectura con preguntas al final y pasa a ser un
-- formulario que el alumno rellena dentro del portal. Una fila por persona y
-- ejercicio, sobrescrita en cada autoguardado.

-- AlterEnum
ALTER TYPE "LessonContentType" ADD VALUE 'EXERCISE';

-- AlterTable
ALTER TABLE "live_class_sessions" ADD COLUMN "exercise_json" JSONB;

-- CreateTable
CREATE TABLE "exercise_responses" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercise_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exercise_responses_class_id_idx" ON "exercise_responses"("class_id");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_responses_contact_id_class_id_key" ON "exercise_responses"("contact_id", "class_id");

-- AddForeignKey
ALTER TABLE "exercise_responses" ADD CONSTRAINT "exercise_responses_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "live_class_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_responses" ADD CONSTRAINT "exercise_responses_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
