import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Gemini (Google AI Studio, capa gratuita) para autocompletado en el CRM.
 * Opcional: sin GEMINI_API_KEY la funcionalidad de IA se oculta por completo.
 */
export const isAiConfigured = (): boolean =>
  Boolean(process.env.GEMINI_API_KEY?.trim());

const DEFAULT_MODEL = "gemini-2.5-flash-lite";

export const getGeminiModel = () => {
  const google = createGoogleGenerativeAI({
    // Explícito: la var por defecto del SDK es GOOGLE_GENERATIVE_AI_API_KEY.
    apiKey: process.env.GEMINI_API_KEY?.trim(),
  });
  return google(process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL);
};
