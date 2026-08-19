/**
 * El cuestionario público de `/diagnostico`, como datos.
 *
 * Vive aquí y no dentro del componente por una razón operativa: el copy de un
 * embudo se reescribe muchas más veces que su interfaz. Con las preguntas como
 * datos, cambiar una palabra —o el orden, o los pesos— no toca React, no
 * arriesga una regresión de render y lo puede revisar alguien que no programa.
 *
 * El orden importa y no es estético: va de lo emocional a lo concreto. Las
 * preguntas 1–5 hacen que la persona nombre su dolor y su yo futuro **con sus
 * propias palabras**; la 6–8 miden urgencia e intención; los datos de contacto
 * van al final, cuando ya hay inversión emocional. Pedirlos primero es lo que
 * convierte un cuestionario en un formulario.
 */

export type DiagnosticQuestionId =
  | "dolor"
  | "tiempo"
  | "manifestacion"
  | "intentos"
  | "meta"
  | "urgencia"
  | "modalidad"
  | "cuando";

/**
 * Pesos que una opción aporta al scoring. Todos opcionales: una opción puede
 * existir sólo para que la persona se sienta vista, sin mover el resultado.
 */
export type DiagnosticWeights = {
  /** Profundidad del patrón → empuja hacia paquetes largos. */
  profundidad?: number;
  /** Urgencia declarada → empuja hacia comprar ahora. */
  urgencia?: number;
  /** Preferencia de formato: 1:1, grupo o a su ritmo. */
  modalidad?: "individual" | "grupo" | "autonomo";
};

export type DiagnosticOption = {
  id: string;
  label: string;
  /** Frase corta bajo la opción. Opcional: no todas la necesitan. */
  hint?: string;
  weights?: DiagnosticWeights;
};

export type DiagnosticQuestion = {
  id: DiagnosticQuestionId;
  /** Lo que se lee en grande. Segunda persona, siempre. */
  prompt: string;
  /** Apoyo bajo el titular. Opcional. */
  help?: string;
  type: "single" | "multi" | "scale" | "text";
  options?: DiagnosticOption[];
  /** Sólo `text`: marcador de posición. */
  placeholder?: string;
  /** Sólo `scale`: extremos de la escala 1–10. */
  scaleLabels?: { low: string; high: string };
  /** Un paso sin respuesta no deja avanzar. `meta` es la única opcional. */
  required: boolean;
};

export const DIAGNOSTIC_QUESTIONS: DiagnosticQuestion[] = [
  {
    id: "dolor",
    prompt: "¿Qué es lo que más te pesa hoy?",
    help: "Elige lo que más se acerque. No hay respuesta correcta.",
    type: "single",
    required: true,
    options: [
      {
        id: "ansiedad",
        label: "Ansiedad y miedo",
        hint: "La mente no para, el cuerpo tampoco",
      },
      {
        id: "pareja",
        label: "Mi relación de pareja",
        hint: "O la falta de una que funcione",
      },
      {
        id: "duelo",
        label: "Un duelo o algo que no he soltado",
        hint: "Una pérdida, un trauma, algo del pasado",
      },
      {
        id: "autoestima",
        label: "No me siento suficiente",
        hint: "Autoestima, valor propio, complacer a todos",
      },
      {
        id: "proposito",
        label: "No sé para dónde voy",
        hint: "Propósito, dirección, sentido",
      },
      {
        id: "dinero",
        label: "Mi relación con el dinero",
        hint: "Escasez, techo, autosabotaje económico",
      },
    ],
  },
  {
    id: "tiempo",
    prompt: "¿Hace cuánto lo sientes?",
    help: "Esto define la profundidad del proceso, no su precio.",
    type: "single",
    required: true,
    options: [
      { id: "semanas", label: "Unas semanas", weights: { profundidad: 0 } },
      { id: "meses", label: "Varios meses", weights: { profundidad: 1 } },
      { id: "anios", label: "Años", weights: { profundidad: 3 } },
      {
        id: "siempre",
        label: "Desde que tengo memoria",
        weights: { profundidad: 4 },
      },
    ],
  },
  {
    id: "manifestacion",
    prompt: "¿Cómo se te nota en el día a día?",
    help: "Marca todas las que reconozcas.",
    type: "multi",
    required: true,
    options: [
      { id: "sueno", label: "No duermo bien", weights: { profundidad: 1 } },
      { id: "evito", label: "Evito a la gente", weights: { profundidad: 1 } },
      {
        id: "bloqueo",
        label: "Me bloqueo cuando tengo que decidir",
        weights: { profundidad: 1 },
      },
      {
        id: "exploto",
        label: "Exploto por cosas pequeñas",
        weights: { profundidad: 1 },
      },
      {
        id: "repito",
        label: "Repito siempre la misma historia",
        weights: { profundidad: 2 },
      },
      {
        id: "cuerpo",
        label: "Se me manifiesta en el cuerpo",
        hint: "Dolores, tensión, cansancio sin causa",
        weights: { profundidad: 2 },
      },
      {
        id: "aparento",
        label: "Por fuera estoy bien, por dentro no",
        weights: { profundidad: 2 },
      },
    ],
  },
  {
    id: "intentos",
    prompt: "¿Ya intentaste algo para resolverlo?",
    type: "single",
    required: true,
    options: [
      { id: "nada", label: "Todavía no", weights: { profundidad: 0 } },
      {
        id: "contenido",
        label: "Libros, videos, contenido",
        weights: { profundidad: 1 },
      },
      {
        id: "terapia",
        label: "Terapia tradicional",
        hint: "Psicología, psiquiatría",
        weights: { profundidad: 2 },
      },
      {
        id: "coach",
        label: "Otro coach o terapeuta",
        weights: { profundidad: 2 },
      },
    ],
  },
  {
    id: "meta",
    prompt: "¿Qué querrías estar sintiendo dentro de tres meses?",
    help: "Escríbelo como te salga. Vas a volver a leer esto al final.",
    type: "text",
    placeholder: "Tranquila. Sin ese nudo en el pecho cada mañana…",
    required: false,
  },
  {
    id: "urgencia",
    prompt: "Del 1 al 10, ¿qué tan urgente es para ti resolverlo?",
    type: "scale",
    scaleLabels: { low: "Puedo esperar", high: "Ya no aguanto más" },
    required: true,
  },
  {
    id: "modalidad",
    prompt: "¿Cómo prefieres trabajarlo?",
    type: "single",
    required: true,
    options: [
      {
        id: "individual",
        label: "A solas con Dayana",
        hint: "Sesiones privadas 1:1",
        weights: { modalidad: "individual" },
      },
      {
        id: "grupo",
        label: "En grupo, acompañado de otras personas",
        hint: "Clases en vivo",
        weights: { modalidad: "grupo" },
      },
      {
        id: "autonomo",
        label: "A mi ritmo, sin horarios",
        weights: { modalidad: "autonomo" },
      },
    ],
  },
  {
    id: "cuando",
    prompt: "¿Cuándo quieres empezar?",
    type: "single",
    required: true,
    options: [
      { id: "semana", label: "Esta semana", weights: { urgencia: 3 } },
      { id: "mes", label: "Este mes", weights: { urgencia: 1 } },
      {
        id: "explorando",
        label: "Solo estoy explorando",
        weights: { urgencia: -3 },
      },
    ],
  },
];

/** El paso de datos de contacto no está en el array: no es una pregunta con peso. */
export const DIAGNOSTIC_TOTAL_STEPS = DIAGNOSTIC_QUESTIONS.length + 1;

export type DiagnosticAnswers = Partial<
  Record<DiagnosticQuestionId, string | string[]>
>;

const QUESTIONS_BY_ID = new Map(DIAGNOSTIC_QUESTIONS.map((q) => [q.id, q]));

export const getDiagnosticQuestion = (
  id: string,
): DiagnosticQuestion | undefined =>
  QUESTIONS_BY_ID.get(id as DiagnosticQuestionId);

/**
 * Normaliza lo que llega del cliente. Descarta cualquier clave desconocida y
 * cualquier opción que no exista en el catálogo.
 *
 * No es paranoia: las respuestas se persisten como Json y se vuelven a leer
 * para renderizar la página de resultado, así que sin este filtro un `PATCH`
 * podría plantar texto arbitrario en una página pública.
 */
export function sanitizeAnswers(input: unknown): DiagnosticAnswers {
  if (typeof input !== "object" || input == null) return {};
  const out: DiagnosticAnswers = {};

  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const question = getDiagnosticQuestion(key);
    if (!question) continue;

    if (question.type === "text") {
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim().slice(0, 500);
      if (trimmed) out[question.id] = trimmed;
      continue;
    }

    if (question.type === "scale") {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 10) continue;
      out[question.id] = String(n);
      continue;
    }

    const valid = new Set((question.options ?? []).map((o) => o.id));

    if (question.type === "multi") {
      if (!Array.isArray(raw)) continue;
      const picked = raw.filter(
        (v): v is string => typeof v === "string" && valid.has(v),
      );
      if (picked.length) out[question.id] = picked;
      continue;
    }

    if (typeof raw === "string" && valid.has(raw)) out[question.id] = raw;
  }

  return out;
}

/** ¿Está contestada la pregunta? Lo usan el wizard y el guardia de `complete`. */
export function isAnswered(
  question: DiagnosticQuestion,
  answers: DiagnosticAnswers,
): boolean {
  const value = answers[question.id];
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" && value.length > 0;
}

/** Etiqueta legible de una respuesta, para el resultado y el panel del CRM. */
export function answerLabel(
  questionId: DiagnosticQuestionId,
  value: string,
): string {
  const question = QUESTIONS_BY_ID.get(questionId);
  if (!question) return value;
  if (question.type === "scale") return `${value}/10`;
  if (question.type === "text") return value;
  return question.options?.find((o) => o.id === value)?.label ?? value;
}

/** Todas las etiquetas de una respuesta, aplanando las de selección múltiple. */
export function answerLabels(
  questionId: DiagnosticQuestionId,
  value: string | string[] | undefined,
): string[] {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((v) => answerLabel(questionId, v));
}
