import { classifyConversation, isClassifyEnabled, reclassifyByRulesNow } from "../chat-category";
import type { classifyWithAi } from "../chat-category-ai";
import { isSilencingCategory } from "../chat-category-rules";

/**
 * ¿La IA calla en este chat por su categoría (personal, negocio/app, equipo)?
 * Lo decide `run.ts` una vez por vuelta. Importes estáticos a propósito: esto
 * se empaqueta también para el agente (eve no admite un `import()` dinámico
 * nuevo en ese árbol).
 *
 * - Clasificación apagada: nunca calla y no se mira nada (ni reglas ni IA).
 * - Vuelve a pasar las reglas (sin IA), por si cambió algo en el CRM.
 * - Manual o regla: manda eso.
 * - Etiqueta de la IA que callaría pero quedó vieja (la persona escribió
 *   después): solo en la puerta de la IA (`allowAi`), una llamada corta a la
 *   IA en el momento y se usa lo que diga. Si falla, tarda o Google la bloquea,
 *   no calla: la IA contesta como siempre.
 *
 * Nunca lanza: ante cualquier error, no calla.
 */

/** Lo más que puede tardar la IA en volver a mirar una etiqueta vieja antes de contestar. */
export const GATE_AI_TIMEOUT_MS = 8_000;

type Classifier = typeof classifyWithAi;
let testClassifier: Classifier | null = null;

/** Solo para las pruebas: la IA que vuelve a mirar las etiquetas viejas (`null`: la de verdad). */
export const setGateClassifierForTests = (fn: Classifier | null) => {
  testClassifier = fn;
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)))]).finally(() =>
    clearTimeout(timer)
  );
};

type RulesNow = Awaited<ReturnType<typeof reclassifyByRulesNow>>;

/** La IA vuelve a mirar el chat ahora. La categoría si calla; `null` si no, o si algo falló. */
const refreshWithAi = async (conversationId: string): Promise<string | null> => {
  const outcome = await withTimeout(
    classifyConversation(conversationId, {
      deadline: Date.now() + GATE_AI_TIMEOUT_MS,
      ...(testClassifier ? { classifier: testClassifier } : {}),
    }),
    GATE_AI_TIMEOUT_MS + 2_000
  );
  if (!outcome) {
    console.warn("[whatsapp-agent] la IA tardó demasiado en volver a mirar la categoría: no calla");
    return null;
  }
  if (outcome.status !== "classified") return null;
  const fresh = {
    category: outcome.category,
    categorySource: outcome.source,
    categoryConfidence: outcome.confidence,
    categoryReview: outcome.review,
  };
  return isSilencingCategory(fresh, { enabled: true }) ? outcome.category : null;
};

export type CategoryGate = (opts: { allowAi: boolean }) => Promise<string | null>;

/** Una por vuelta: las reglas y la IA se miran como mucho una vez. */
export const categoryGate = (conversationId: string): CategoryGate => {
  let rules: Promise<RulesNow> | null = null;
  let refreshed: Promise<string | null> | null = null;
  const rulesNow = async (): Promise<RulesNow> =>
    (await isClassifyEnabled()) ? reclassifyByRulesNow(conversationId) : null;

  return async ({ allowAi }) => {
    try {
      if (refreshed) return await refreshed;
      const now = await (rules ??= rulesNow());
      if (!now) return null;
      if (!now.stale) return now.silencing ? now.category : null;
      // Vieja: solo merece la llamada si lo guardado callaría.
      if (!allowAi || !isSilencingCategory(now, { enabled: true })) return null;
      return await (refreshed ??= refreshWithAi(conversationId));
    } catch (e) {
      console.warn("[whatsapp-agent] no se pudo mirar la categoría: no calla", e);
      return null;
    }
  };
};
