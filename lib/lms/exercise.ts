import { prisma } from "@/lib/db";

/**
 * Forma de `exerciseJson`.
 *
 * Un ejercicio es una lista de campos que el alumno rellena. No hay respuestas
 * correctas: esto es el cuaderno del curso, no una evaluación — para eso está
 * el cuestionario.
 */
export type ExerciseField = {
  id: string;
  /** La pregunta o consigna. */
  label: string;
  /** Aclaración corta debajo del campo. */
  help?: string;
  /** `long` para reflexiones, `short` para una línea, `choice` para elegir. */
  type?: "long" | "short" | "choice";
  /** Solo para `choice`. */
  options?: string[];
  placeholder?: string;
  /** Cuenta para considerar el ejercicio terminado. Por defecto, sí. */
  required?: boolean;
};

export type ExerciseSection = {
  /** Encabezado que agrupa varios campos; opcional. */
  title?: string;
  /** Texto introductorio en markdown. */
  bodyMd?: string;
  fields: ExerciseField[];
};

export type ExerciseJson = {
  /** Introducción del ejercicio, en markdown. */
  introMd?: string;
  sections: ExerciseSection[];
  /** Cierre en markdown: la reflexión final, la frase de Dayana. */
  closingMd?: string;
};

export type ExerciseAnswers = Record<string, string>;

export const readExercise = (value: unknown): ExerciseJson | null => {
  const parsed = value as ExerciseJson | null;
  if (!parsed || !Array.isArray(parsed.sections)) return null;
  return parsed;
};

export const exerciseFields = (exercise: ExerciseJson): ExerciseField[] =>
  exercise.sections.flatMap((s) => s.fields);

/**
 * Un ejercicio está terminado cuando todos sus campos obligatorios tienen algo
 * escrito. Es lo que dispara el «completada» — no hace falta que el alumno lo
 * marque a mano.
 */
export const isExerciseComplete = (
  exercise: ExerciseJson,
  answers: ExerciseAnswers
): boolean => {
  const required = exerciseFields(exercise).filter((f) => f.required !== false);
  if (required.length === 0) return false;
  return required.every((f) => (answers[f.id] ?? "").trim().length > 0);
};

export const getExerciseAnswers = async (
  classId: string,
  contactId: string
): Promise<ExerciseAnswers> => {
  const row = await prisma.exerciseResponse.findUnique({
    where: { contactId_classId: { contactId, classId } },
    select: { answers: true },
  });
  return (row?.answers as ExerciseAnswers | undefined) ?? {};
};

/** Guarda (o sobrescribe) las respuestas. Sin historial: es un cuaderno. */
export const saveExerciseAnswers = async (
  classId: string,
  contactId: string,
  answers: ExerciseAnswers
) =>
  prisma.exerciseResponse.upsert({
    where: { contactId_classId: { contactId, classId } },
    create: { classId, contactId, answers },
    update: { answers },
  });
