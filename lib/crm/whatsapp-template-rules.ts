// Reglas de Meta para plantillas. Puro: lo usa también la pantalla de Plantillas.

/**
 * Las reglas de Meta que más rechazos causan, revisadas antes de enviar: no
 * empezar ni terminar con una variable, ni dos variables seguidas.
 */
export const templateBodyProblem = (body: string): string | null => {
  const t = body.trim();
  if (/^\{\{\w+\}\}/.test(t)) return "No puede empezar con una variable: pon un saludo antes.";
  if (/\{\{\w+\}\}[\s.!?¡¿:,;]*$/.test(t))
    return "No puede terminar con una variable (por ejemplo el enlace): agrega una frase después.";
  if (/\}\}\s*\{\{/.test(t)) return "No puede tener dos variables seguidas: pon texto entre ellas.";
  if (t.length > 1024) return "Es demasiado larga (máximo 1024 caracteres).";
  return null;
};

const PROMO_WORDS = /\b(gratis|descuento|oferta|promo|promoción|regalo|te invito|invitamos|aprovecha|última oportunidad|cupos)\b/i;

/**
 * Una plantilla de UTILIDAD (recordatorios, pagos) con palabras de venta
 * Meta la reclasifica como MARKETING (más cara y más lenta de aprobar).
 */
export const utilityCategoryWarning = (category: string, body: string): string | null =>
  category === "UTILITY" && PROMO_WORDS.test(body)
    ? "Tiene palabras de promoción: Meta la aprobaría como Marketing (más cara). Déjala informativa o elige Marketing."
    : null;

