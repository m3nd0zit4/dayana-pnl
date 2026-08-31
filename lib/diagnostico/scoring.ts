import {
  isQuestionVisible,
  visibleQuestions,
  type DiagnosticAnswers,
  type DiagnosticQuestion,
} from "./questions";

/**
 * Scoring del cuestionario. Función pura y sin I/O a propósito: se ejecuta en
 * el servidor al completar, pero también en el cliente para previsualizar, y
 * en los tests sin base de datos.
 *
 * Nota sobre lo que *no* hace: no puntúa respuestas correctas. Aquí no hay
 * correctas. Segmenta. El motor de quiz del LMS (`lib/lms/quiz.ts`) sí es de
 * nota y aprobado, y por eso no se reutiliza: son dos problemas distintos que
 * comparten la palabra "cuestionario".
 */

export type DiagnosticProfileId =
  | "EXPLORADOR"
  | "EN_PROCESO"
  | "RAIZ_PROFUNDA";

export type DiagnosticModality = "individual" | "grupo" | "autonomo";

export type DiagnosticScore = {
  profile: DiagnosticProfileId;
  /** 1–10. Lo que la persona declaró, corregido por cuándo quiere empezar. */
  urgencyScore: number;
  /** Suma cruda de pesos de profundidad. Sólo para depurar y para el CRM. */
  depthScore: number;
  /**
   * 0–10. Cuán cerca está de decidirse: qué la ha frenado, por qué eligió a
   * Dayana y si puede invertir. Ordena la bandeja del CRM — es la respuesta a
   * "¿a quién llamo primero?" — y acota la recomendación hacia abajo.
   */
  commitmentScore: number;
  /** La persona declaró que hoy no puede invertir. Topa la recomendación. */
  investmentBlocked: boolean;
  modality: DiagnosticModality;
  /** Slug del producto que se le muestra. Puede no existir o estar inactivo. */
  recommendedProductId: string;
  /** El siguiente escalón, para el bloque de "si quieres ir más a fondo". */
  upgradeProductId: string | null;
};

/** Umbrales del scoring, juntos y con nombre para que se puedan discutir. */
const THRESHOLDS = {
  /** Por debajo de esto la persona no compra hoy: se le nutre, no se le vende. */
  explorerUrgency: 6,
  /** Patrón de raíz: años de historia y varias manifestaciones a la vez. */
  deepDepth: 7,
  deepUrgency: 8,
} as const;

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

const asArray = (value: string | string[] | undefined): string[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

function optionsFor(question: DiagnosticQuestion, answers: DiagnosticAnswers) {
  const picked = new Set(asArray(answers[question.id]));
  return (question.options ?? []).filter((o) => picked.has(o.id));
}

export function scoreDiagnostic(answers: DiagnosticAnswers): DiagnosticScore {
  let depthScore = 0;
  let urgencyBonus = 0;
  let commitmentRaw = 0;
  let investmentBlocked = false;
  let modality: DiagnosticModality = "individual";

  // Sólo las preguntas que se le llegaron a hacer. Puntuar una pregunta
  // oculta con los pesos de una respuesta vieja —si volvió atrás y cambió
  // "cuándo quieres empezar"— le atribuiría algo que ya no dijo.
  for (const question of visibleQuestions(answers)) {
    for (const option of optionsFor(question, answers)) {
      const w = option.weights;
      if (!w) continue;
      if (w.profundidad) depthScore += w.profundidad;
      if (w.urgencia) urgencyBonus += w.urgencia;
      if (w.compromiso) commitmentRaw += w.compromiso;
      if (w.bloqueaInversion) investmentBlocked = true;
      if (w.modalidad) modality = w.modalidad;
    }
  }

  // `porqueDayana` es de selección múltiple, así que sus pesos se suman y una
  // persona que marca cuatro razones podría dispararse. Se comprime a 0–10
  // sobre un máximo realista en vez de dejar que la escala dependa de cuántas
  // casillas marcó.
  const commitmentScore = clamp(Math.round(commitmentRaw + 3), 0, 10);

  // La urgencia ya no se pregunta con una escala del 1 al 10: se deriva de
  // cuánto lleva con esto y de cuándo quiere empezar. Pedirle a alguien que
  // calibre su propio dolor en una escala numérica es la parte más lenta de
  // contestar y la menos fiable de leer — cada persona usa la escala distinto,
  // mientras que "esta semana" significa lo mismo para todas.
  const urgencyScore = clamp(3 + urgencyBonus, 1, 10);

  // "Solo estoy explorando" manda por encima de todo lo demás: alguien puede
  // declarar un 9 de urgencia y aun así decir que no piensa empezar. Creerle a
  // la acción declarada antes que al sentimiento declarado es lo que evita
  // ponerle un paquete de doce sesiones delante a quien vino a mirar.
  const justBrowsing = answers.cuando === "explorando";

  // Quien sólo está mirando no ve el tramo de intención, así que su
  // `commitmentScore` sale del suelo (3) sin haber contestado nada. Se deja
  // explícito en 0 para que la bandeja del CRM no lo mezcle con quien sí
  // contestó y puntuó bajo: son dos cosas distintas.
  const commitment = justBrowsing ? 0 : commitmentScore;

  const profile: DiagnosticProfileId = justBrowsing
    ? "EXPLORADOR"
    : urgencyScore < THRESHOLDS.explorerUrgency
      ? "EXPLORADOR"
      : depthScore >= THRESHOLDS.deepDepth &&
          urgencyScore >= THRESHOLDS.deepUrgency
        ? "RAIZ_PROFUNDA"
        : "EN_PROCESO";

  const { recommendedProductId, upgradeProductId } = capToInvestment(
    recommendProduct(profile, modality),
    investmentBlocked,
  );

  return {
    profile,
    urgencyScore,
    depthScore,
    commitmentScore: commitment,
    investmentBlocked,
    modality,
    recommendedProductId,
    upgradeProductId,
  };
}

/**
 * Techo por capacidad de inversión declarada.
 *
 * Quien acaba de escribir "todavía no puedo invertir" y recibe un paquete de
 * $3.600.000 no compra: cierra la pestaña, y con ella se va la confianza que
 * las preguntas anteriores acababan de construir. Se le recomienda el
 * primer escalón, que es lo único que puede decir que sí.
 *
 * El tope **sólo baja**. Un compromiso alto no sube nada: la recomendación la
 * decide el problema, no las ganas.
 */
function capToInvestment(
  recommendation: { recommendedProductId: string; upgradeProductId: string | null },
  investmentBlocked: boolean,
) {
  if (!investmentBlocked) return recommendation;
  // El curso se queda: es la opción barata y recurrente, y para quien no puede
  // pagar un paquete de terapia suele ser exactamente la puerta correcta.
  if (recommendation.recommendedProductId === "course-live") {
    return { recommendedProductId: "course-live", upgradeProductId: null };
  }
  return { recommendedProductId: "therapy-1", upgradeProductId: null };
}

/**
 * La modalidad elige la **familia** de producto y el perfil elige la
 * profundidad dentro de ella. Separarlos evita el error de recomendarle doce
 * sesiones 1:1 a quien acaba de decir que prefiere trabajar en grupo.
 */
function recommendProduct(
  profile: DiagnosticProfileId,
  modality: DiagnosticModality,
): { recommendedProductId: string; upgradeProductId: string | null } {
  if (modality !== "individual") {
    // Grupo y "a mi ritmo" convergen en la membresía: son clases en vivo con
    // grabaciones en el portal, así que cubren las dos preferencias.
    return {
      recommendedProductId: "course-live",
      upgradeProductId: profile === "EXPLORADOR" ? null : "therapy-6",
    };
  }

  switch (profile) {
    case "EXPLORADOR":
      return { recommendedProductId: "therapy-1", upgradeProductId: "therapy-3" };
    case "EN_PROCESO":
      return { recommendedProductId: "therapy-6", upgradeProductId: "therapy-12" };
    case "RAIZ_PROFUNDA":
      return {
        recommendedProductId: "therapy-12",
        upgradeProductId: "therapy-24",
      };
  }
}

/**
 * Orden de degradación cuando el producto recomendado no se puede vender en la
 * región del visitante — desactivado, o sin precio en su moneda.
 *
 * `workshop-virtual`, por ejemplo, no tiene precio en COP, así que su botón no
 * renderiza para Colombia. Una página de resultado sin botón de pago es un
 * embudo roto, y prefiero recomendar de menos que no recomendar nada.
 */
export const PRODUCT_FALLBACK_CHAIN: Record<string, string[]> = {
  "therapy-24": ["therapy-12", "therapy-6", "therapy-3", "therapy-1"],
  "therapy-12": ["therapy-6", "therapy-3", "therapy-1"],
  "therapy-6": ["therapy-3", "therapy-1"],
  "therapy-3": ["therapy-1"],
  // `therapy-1` es el destino más frecuente de todos: es lo que recibe cada
  // perfil EXPLORADOR, todo el que declara que hoy no puede invertir, y
  // cualquier diagnóstico que llegue con las respuestas vacías. Tenía la
  // cadena vacía, así que bastaba con desactivarlo o dejarlo sin precio en la
  // moneda del visitante para que una fracción enorme de la gente viera una
  // tarjeta sin precio ni botón. Sube hacia el siguiente escalón: mejor
  // ofrecer de más que no ofrecer nada.
  "therapy-1": ["therapy-3", "course-live"],
  "course-live": ["therapy-1"],
};
