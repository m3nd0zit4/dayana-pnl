/**
 * Las reglas de un envío de WhatsApp desde el CRM, sin base de datos ni red
 * (para probarlas).
 *
 * WhatsApp solo deja escribir texto libre dentro de las 24 h desde el último
 * mensaje de la persona. Fuera de eso hace falta una plantilla aprobada por
 * Meta, que se cobra por mensaje.
 */

export type SendPlan =
  | { action: "text" }
  | { action: "template" }
  | { action: "skip"; reason: "no_phone" | "opted_out" | "needs_template" };

export const planSend = (input: {
  hasPhone: boolean;
  optedOut: boolean;
  windowOpen: boolean;
  hasApprovedTemplate: boolean;
}): SendPlan => {
  if (!input.hasPhone) return { action: "skip", reason: "no_phone" };
  if (input.optedOut) return { action: "skip", reason: "opted_out" };
  if (input.windowOpen) return { action: "text" };
  if (input.hasApprovedTemplate) return { action: "template" };
  return { action: "skip", reason: "needs_template" };
};

/** Reemplaza {{nombre}}, {{evento}}… Lo que no tiene valor se quita. */
export const fillVars = (text: string, vars: Record<string, string | null | undefined>): string =>
  text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, key: string) => vars[key]?.toString().trim() ?? "");

/** Los valores de {{1}}, {{2}}… de una plantilla, en el orden que tiene aprobado. */
export const templateParams = (
  varNames: string[],
  vars: Record<string, string | null | undefined>
): string[] =>
  // WhatsApp rechaza un parámetro vacío: se pone un guion.
  varNames.map((name) => vars[name]?.toString().trim() || "-");

/** Primer nombre, para saludar sin sonar a formulario. */
export const firstName = (full: string | null | undefined): string =>
  (full ?? "").trim().split(/\s+/)[0] ?? "";

/**
 * Palabras con las que alguien pide que no le escriban más. Se miran solo en
 * mensajes cortos: «no más» en medio de una historia larga no es una baja.
 */
export const isOptOutMessage = (body: string | null | undefined): boolean => {
  const text = (body ?? "").trim().toLowerCase();
  if (!text || text.length > 60) return false;
  return /^(stop|baja|cancelar suscripci[oó]n|no m[aá]s mensajes|no me escrib(as|an)( m[aá]s)?|no quiero (recibir )?m[aá]s mensajes|no m[aá]s)[.!¡ ]*$/i.test(
    text
  );
};

export type SendSummary = {
  total: number;
  text: number;
  template: number;
  skipped: { no_phone: number; opted_out: number; needs_template: number };
  estimatedCost: number;
};

/** Cuántos van gratis, cuántos por plantilla (y cuánto costaría), cuántos no. */
export const summarizePlans = (plans: SendPlan[], pricePerTemplate: number): SendSummary => {
  const summary: SendSummary = {
    total: plans.length,
    text: 0,
    template: 0,
    skipped: { no_phone: 0, opted_out: 0, needs_template: 0 },
    estimatedCost: 0,
  };
  for (const p of plans) {
    if (p.action === "text") summary.text++;
    else if (p.action === "template") summary.template++;
    else summary.skipped[p.reason]++;
  }
  summary.estimatedCost = Math.round(summary.template * pricePerTemplate * 10000) / 10000;
  return summary;
};
