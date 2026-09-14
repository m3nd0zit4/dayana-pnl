import {
  sanitizeAnswers,
  visibleQuestions,
  answerLabels,
} from "@/lib/diagnostico/questions";

/**
 * Traduce las respuestas crudas de un diagnóstico a algo que Dayana puede leer
 * sin conocer los ids del cuestionario.
 *
 * Función pura a propósito, igual que `scoreDiagnostic`: la usan tanto la
 * consulta del CRM (`lib/crm/diagnostics.ts`) como sus tests, sin base de
 * datos de por medio. Sólo importa de `lib/diagnostico/*` — nunca de Prisma —
 * para que se pueda ejecutar en el cliente el día que haga falta una vista
 * previa antes de guardar.
 */

export type DiagnosticAnswerItem = {
  /** Id de la pregunta, tal y como vive en `DIAGNOSTIC_QUESTIONS`. */
  id: string;
  /** El prompt tal y como lo leyó la persona. */
  question: string;
  /** Etiquetas legibles. Vacío si la pregunta era visible y no se contestó. */
  answers: string[];
  /** Pista de la opción elegida, solo en preguntas de una sola respuesta. */
  hint?: string;
};

type QuestionLike = {
  id: string;
  prompt: string;
  type: "single" | "multi" | "scale" | "text";
  options?: { id: string; label: string; hint?: string }[];
  showIf?: { question: string; notEquals: string[] };
};

type AnswersLike = Partial<Record<string, string | string[]>>;

/**
 * Las piezas del cuestionario que usa la traducción.
 *
 * Se inyectan para poder probar tipos de pregunta que el cuestionario real ya
 * no tiene (`multi`, `scale`, `text`) sin `mock.module`, que en `bun test`
 * sustituye el módulo para todo el proceso y rompía cualquier otro test que lo
 * importara. Van declaradas como métodos a propósito: así aceptan las
 * funciones reales, cuyos parámetros usan los ids tipados del cuestionario.
 */
export type DiagnosticQuestionnaire = {
  sanitizeAnswers(input: unknown): AnswersLike;
  visibleQuestions(answers: AnswersLike): readonly QuestionLike[];
  answerLabels(questionId: string, value: string | string[] | undefined): string[];
};

const REAL_QUESTIONNAIRE: DiagnosticQuestionnaire = {
  sanitizeAnswers,
  visibleQuestions,
  answerLabels,
};

/**
 * Igual que `buildDiagnosticAnswers`, pero contra el cuestionario que se le
 * pase. Existe para los tests.
 */
export function buildDiagnosticAnswersWith(
  questionnaire: DiagnosticQuestionnaire,
  answers: unknown,
): DiagnosticAnswerItem[] {
  // Cualquier cosa que no sea un objeto de verdad (string, número, null,
  // undefined) no es un `DiagnosticAnswers` disfrazado: es basura, y se
  // responde con una lista vacía en vez de fingir que hay un cuestionario
  // sin contestar detrás.
  if (typeof answers !== "object" || answers === null) return [];

  const sanitized = questionnaire.sanitizeAnswers(answers);
  const items: DiagnosticAnswerItem[] = [];

  for (const question of questionnaire.visibleQuestions(sanitized)) {
    const value = sanitized[question.id];
    const labels = questionnaire.answerLabels(question.id, value);

    // Una pregunta condicionada cuya condición nunca se contestó —
    // diagnósticos de antes de `orientacion`— sale como visible por defecto,
    // y entonces las dos preguntas de foco aparecían a la vez, una de ellas
    // «sin responder». Si tampoco se contestó ella misma, no se pinta.
    const parentUnanswered =
      question.showIf && typeof sanitized[question.showIf.question] !== "string";
    if (parentUnanswered && labels.length === 0) continue;

    const item: DiagnosticAnswerItem = {
      id: question.id,
      question: question.prompt,
      answers: labels,
    };

    // El hint solo tiene sentido cuando hay una única opción elegida: en
    // multi no hay "la" opción, y escala/texto no llevan hint.
    if (question.type === "single" && typeof value === "string") {
      const hint = question.options?.find((o) => o.id === value)?.hint;
      if (hint) item.hint = hint;
    }

    items.push(item);
  }

  return items;
}

/**
 * Las preguntas visibles del cuestionario, en orden, con su respuesta ya
 * traducida.
 *
 * Acepta el `Json` crudo de Prisma sin más: `sanitizeAnswers` descarta
 * cualquier clave que no sea una pregunta real, así que una pregunta retirada
 * del cuestionario no revienta un diagnóstico antiguo que la tenía guardada.
 */
export function buildDiagnosticAnswers(answers: unknown): DiagnosticAnswerItem[] {
  return buildDiagnosticAnswersWith(REAL_QUESTIONNAIRE, answers);
}

/**
 * Etiqueta de cada `source` admitido por `createDiagnostic`
 * (`lib/crm/diagnostics.ts`), para no enseñar el slug crudo en el panel.
 */
export const DIAGNOSTIC_SOURCE_LABEL: Record<string, string> = {
  enlaces: "Página de enlaces",
  home: "Inicio",
  terapias: "Página de terapias",
  cursos: "Página de cursos",
  dayana: "Página de Dayana",
  historias: "Historias",
  webinar: "Webinar",
  taller: "Taller",
  ad: "Anuncio",
  // Fuente retirada: se queda por los diagnósticos que ya se guardaron con
  // ella (ver `SOURCES` en `lib/crm/diagnostics.ts`).
  servicios: "Servicios (antiguo)",
};

/** Etiqueta legible de `source`, o el valor crudo si no se reconoce. */
export const diagnosticSourceLabel = (source: string | null): string | null =>
  source == null ? null : (DIAGNOSTIC_SOURCE_LABEL[source] ?? source);
