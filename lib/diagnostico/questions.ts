/**
 * El cuestionario público de `/terapias/empezar`, como datos.
 *
 * Vive aquí y no dentro del componente por una razón operativa: el copy de un
 * embudo se reescribe muchas más veces que su interfaz. Con las preguntas como
 * datos, cambiar una palabra —o el orden, o los pesos— no toca React, no
 * arriesga una regresión de render y lo puede revisar alguien que no programa.
 *
 * **Ocho como mucho, y ninguna se escribe.** Hubo una versión de doce con dos
 * campos de texto libre y una escala del 1 al 10. Cada campo de texto es un
 * teclado que se abre en el móvil y una pantalla que se tapa a sí misma, y la
 * escala pedía calibrar un número cuando la pregunta "¿cuándo quieres empezar?"
 * mide lo mismo con tres toques. Se fueron los dos textos, la escala y la
 * pregunta de qué habías intentado —que `freno` ya responde—. Todo se contesta
 * tocando hasta el paso de contacto, que es el único que pide escribir y llega
 * cuando ya hay motivo para hacerlo.
 *
 * El orden sí es deliberado: primero el problema, luego la decisión. Los datos
 * de contacto van al final, cuando ya hay inversión emocional; pedirlos
 * primero es lo que convierte un cuestionario en un formulario.
 */

export type DiagnosticQuestionId =
  | "dolor"
  | "tiempo"
  | "manifestacion"
  | "modalidad"
  | "cuando"
  // Tramo 2 — intención y compromiso. Las cinco de arriba miden el dolor; sin
  // estas tres el cuestionario recomienda un paquete sin saber si la persona
  // puede pagarlo, cómo llegó, ni qué la ha frenado hasta hoy — que es
  // exactamente lo que la llamada de ventas averigua antes de decir un precio.
  //
  // Se saltan enteras para quien responde que sólo está mirando: preguntarle
  // a esa persona si puede invertir es justo la pregunta que sobra.
  | "freno"
  | "porqueDayana"
  | "inversion";

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
  /**
   * Disposición real a empezar. **Sólo acota hacia abajo**: un compromiso alto
   * nunca sube la recomendación, pero uno bajo la baja. Ver `scoring.ts`.
   */
  compromiso?: number;
  /** `true` en la opción que declara no poder invertir ahora mismo. */
  bloqueaInversion?: boolean;
};

export type DiagnosticOption = {
  id: string;
  label: string;
  /** Frase corta bajo la opción. Opcional: no todas la necesitan. */
  hint?: string;
  weights?: DiagnosticWeights;
};

/**
 * Condición para que una pregunta se muestre. Declarativa a propósito: si
 * fuera una función, el cuestionario dejaría de ser un archivo de datos que
 * puede revisar alguien que no programa.
 */
export type DiagnosticCondition = {
  question: DiagnosticQuestionId;
  /** Se muestra salvo que la respuesta a `question` esté en esta lista. */
  notEquals: string[];
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
  /** Un paso sin respuesta no deja avanzar. */
  required: boolean;
  /** Si no se cumple, la pregunta ni se muestra ni se puntúa. */
  showIf?: DiagnosticCondition;
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
      { id: "semanas", label: "Unas semanas", weights: { profundidad: 0, urgencia: 1 } },
      { id: "meses", label: "Varios meses", weights: { profundidad: 2, urgencia: 2 } },
      { id: "anios", label: "Años", weights: { profundidad: 4, urgencia: 3 } },
      {
        id: "siempre",
        label: "Desde que tengo memoria",
        weights: { profundidad: 5, urgencia: 3 },
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
      {
        id: "bloqueo",
        label: "Me bloqueo cuando tengo que decidir",
        weights: { profundidad: 2 },
      },
      {
        id: "repito",
        label: "Repito siempre la misma historia",
        weights: { profundidad: 3 },
      },
      {
        id: "cuerpo",
        label: "Se me manifiesta en el cuerpo",
        hint: "Dolores, tensión, cansancio sin causa",
        weights: { profundidad: 3 },
      },
      {
        id: "aparento",
        label: "Por fuera estoy bien, por dentro no",
        weights: { profundidad: 3 },
      },
    ],
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
      { id: "semana", label: "Esta semana", weights: { urgencia: 4, compromiso: 2 } },
      { id: "mes", label: "Este mes", weights: { urgencia: 2, compromiso: 1 } },
      {
        id: "explorando",
        label: "Solo estoy explorando",
        weights: { urgencia: -2, compromiso: -2 },
      },
    ],
  },

  // ── Tramo 2 · intención y compromiso ────────────────────────────────────
  //
  // Aquí cambia el registro: hasta ahora se hablaba del problema, ahora de la
  // decisión. Va al final y no al principio porque preguntar "¿puedes
  // invertir?" en frío ahuyenta, y preguntarlo tras cinco respuestas sobre lo
  // que duele es la continuación natural de la conversación.

  {
    id: "freno",
    prompt: "¿Qué te ha frenado hasta ahora?",
    help: "Dayana lo lee antes de responderte, para no darte una respuesta genérica.",
    type: "single",
    required: true,
    showIf: { question: "cuando", notEquals: ["explorando"] },
    options: [
      {
        id: "dinero",
        label: "El dinero",
        hint: "No me parecía el momento de invertir en esto",
      },
      { id: "tiempo", label: "El tiempo", hint: "Nunca encuentro el hueco" },
      {
        id: "miedo",
        label: "Miedo a que no funcione",
        hint: "Ya probé cosas que no sirvieron",
        weights: { compromiso: 1 },
      },
      {
        id: "desconocimiento",
        label: "No sabía por dónde empezar",
        weights: { compromiso: 1 },
      },
      {
        id: "nada",
        label: "Nada. Simplemente no lo había hecho",
        weights: { compromiso: 2 },
      },
    ],
  },
  {
    id: "porqueDayana",
    prompt: "¿Cómo llegaste hasta aquí?",
    help: "Marca todo lo que aplique.",
    type: "multi",
    required: true,
    showIf: { question: "cuando", notEquals: ["explorando"] },
    options: [
      {
        id: "la-sigo",
        label: "La sigo desde hace tiempo",
        weights: { compromiso: 2 },
      },
      {
        id: "me-identifique",
        label: "Me identifiqué con algo que dijo",
        weights: { compromiso: 2 },
      },
      {
        id: "recomendacion",
        label: "Me la recomendaron",
        weights: { compromiso: 2 },
      },
      {
        id: "busco-pnl",
        label: "Busco PNL concretamente",
        hint: "Llegué por el método, no por la persona",
        weights: { compromiso: 1 },
      },
      {
        id: "aun-no-lo-se",
        label: "Todavía no lo sé",
        hint: "Acabo de llegar",
        weights: { compromiso: -1 },
      },
    ],
  },
  {
    id: "inversion",
    prompt: "¿Podrías empezar ahora, o prefieres más adelante?",
    help: "Decide qué te recomendamos. Decir que todavía no es una respuesta válida.",
    type: "single",
    required: true,
    showIf: { question: "cuando", notEquals: ["explorando"] },
    options: [
      { id: "si", label: "Sí", weights: { compromiso: 3 } },
      {
        id: "si-encaja",
        label: "Sí, si veo que encaja conmigo",
        weights: { compromiso: 1 },
      },
      {
        id: "todavia-no",
        label: "Todavía no",
        hint: "Quiero saber qué necesito, pero aún no puedo",
        weights: { compromiso: -3, bloqueaInversion: true },
      },
    ],
  },
];

/**
 * Las preguntas que aplican a estas respuestas, en orden.
 *
 * Es la lista sobre la que camina el asistente. Antes recorría el array
 * completo por índice, así que saltar una pregunta habría descuadrado el
 * contador y "Atrás" habría devuelto justo a la que se acababa de saltar.
 */
export function visibleQuestions(
  answers: DiagnosticAnswers,
): DiagnosticQuestion[] {
  return DIAGNOSTIC_QUESTIONS.filter((q) => isQuestionVisible(q, answers));
}

export function isQuestionVisible(
  question: DiagnosticQuestion,
  answers: DiagnosticAnswers,
): boolean {
  const cond = question.showIf;
  if (!cond) return true;
  const value = answers[cond.question];
  // Sin respuesta todavía a la pregunta que condiciona, se asume visible: es
  // el estado normal antes de llegar a ella.
  if (typeof value !== "string") return true;
  return !cond.notEquals.includes(value);
}

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
