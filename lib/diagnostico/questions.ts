/**
 * El cuestionario público de `/terapias/empezar`, como datos.
 *
 * Vive aquí y no dentro del componente por una razón operativa: el copy de un
 * embudo se reescribe muchas más veces que su interfaz. Con las preguntas como
 * datos, cambiar una palabra —o el orden, o los pesos— no toca React, no
 * arriesga una regresión de render y lo puede revisar alguien que no programa.
 *
 * **Cinco como mucho, y ninguna se escribe.** Hubo una versión de doce con dos
 * campos de texto libre y una escala del 1 al 10, y luego una de ocho. Cada
 * campo de texto es un teclado que se abre en el móvil y una pantalla que se
 * tapa a sí misma. Se acortó otra vez de ocho a cinco fusionando preguntas
 * (`cuando`+`freno`+`inversion` → `cierre`) y retirando la de atribución
 * (`porqueDayana`, que ya cubre `source`) — a cambio de perder granularidad de
 * objeción, decisión explícita a favor de menos fricción. Todo se contesta
 * tocando hasta el paso de contacto, que es el único que pide escribir y llega
 * cuando ya hay motivo para hacerlo.
 *
 * **Dos pistas, no una.** No todo el mundo que llega aquí está mal: algunos
 * quieren soltar algo, otros quieren avanzar sin estar en crisis. La primera
 * pregunta (`orientacion`) decide cuál de las dos ve la persona, y el resto
 * del banco tiene una rama por tema (`foco-emocional` / `foco-crecimiento`)
 * que se muestra según esa respuesta — el mismo mecanismo de `showIf` que ya
 * usaba el cuestionario para saltarse el tramo de intención con quien sólo
 * está explorando.
 *
 * El orden sí es deliberado: primero el problema o la meta, luego la
 * decisión. Los datos de contacto van al final, cuando ya hay inversión
 * emocional; pedirlos primero es lo que convierte un cuestionario en un
 * formulario.
 */

export type DiagnosticQuestionId =
  // Decide el track antes de preguntar nada más: no toda persona que llega
  // aquí está mal. Algunas quieren soltar algo; otras quieren avanzar sin
  // estar en crisis. Preguntarles "¿qué te pesa?" a las segundas fuerza una
  // respuesta falsa entre seis opciones de dolor.
  | "orientacion"
  // Tema. Sólo una de las dos se muestra — ver `showIf` más abajo — según lo
  // que contestó en `orientacion`.
  | "foco-emocional"
  | "foco-crecimiento"
  | "tiempo"
  | "modalidad"
  // Cierre: cuándo, y con qué se topa. Antes eran tres preguntas separadas
  // (`cuando`, `freno`, `inversion`) más una cuarta de atribución
  // (`porqueDayana`); se fusionan en una sola para no pasar de cinco pasos
  // por persona. Se pierde granularidad de objeción a cambio de menos
  // fricción — decisión explícita, no descuido.
  | "cierre";

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
  /** Sólo en `orientacion`: decide qué mitad del cuestionario ve. */
  track?: "emocional" | "crecimiento";
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
    id: "orientacion",
    prompt: "¿Qué te trae hoy aquí?",
    help: "No hay respuesta correcta. Elige lo que más se acerque.",
    type: "single",
    required: true,
    options: [
      {
        id: "pesa",
        label: "Algo me pesa y quiero soltarlo",
        hint: "Ansiedad, una relación, un duelo, algo del pasado",
        weights: { track: "emocional" },
      },
      {
        id: "avanzar",
        label: "Quiero crecer y dar el siguiente paso",
        hint: "No es que esté mal. Quiero ir más lejos",
        weights: { track: "crecimiento" },
      },
    ],
  },
  {
    id: "foco-emocional",
    prompt: "¿Qué es lo que más te pesa hoy?",
    help: "Elige lo que más se acerque. No hay respuesta correcta.",
    type: "single",
    required: true,
    showIf: { question: "orientacion", notEquals: ["avanzar"] },
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
    id: "foco-crecimiento",
    prompt: "¿En qué quieres avanzar?",
    help: "Elige lo que más se acerque. No hay respuesta correcta.",
    type: "single",
    required: true,
    showIf: { question: "orientacion", notEquals: ["pesa"] },
    options: [
      {
        id: "habitos",
        label: "Mis hábitos y mi disciplina",
        hint: "Consistencia, orden, dejar de posponer",
      },
      {
        id: "relaciones",
        label: "Mis relaciones",
        hint: "Comunicarme mejor, estar más presente, conexión",
      },
      {
        id: "carrera",
        label: "Mi carrera, liderazgo o negocio",
        hint: "Confianza para crecer, decidir, liderar",
      },
      {
        id: "proposito",
        label: "El siguiente capítulo de mi vida",
        hint: "Dirección, una decisión grande, reinvención",
      },
    ],
  },
  {
    id: "tiempo",
    prompt: "¿Hace cuánto le das vueltas a esto?",
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
    id: "cierre",
    prompt: "¿Cuándo te gustaría empezar?",
    type: "single",
    required: true,
    options: [
      { id: "ya", label: "Esta semana", weights: { urgencia: 4, compromiso: 3 } },
      {
        id: "mes-organizando",
        label: "Este mes",
        hint: "Estoy organizando tiempo o presupuesto",
        weights: { urgencia: 2, compromiso: 1 },
      },
      {
        id: "pronto-inseguro",
        label: "Pronto",
        hint: "Quiero estar segura/o de que es lo correcto",
        weights: { urgencia: 1, compromiso: 0 },
      },
      {
        id: "explorando",
        label: "Solo estoy explorando",
        hint: "Todavía no puedo decidir",
        weights: { urgencia: -2, compromiso: -2, bloqueaInversion: true },
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
