/**
 * Las dos marcas de WhatsApp de un diagnóstico, a partir de los clics
 * registrados. Pura (sin Prisma) para poder probarla sin base de datos.
 *
 * - **Fue a WhatsApp**: la persona pulsó un botón hacia Dayana. Cuenta el CTA
 *   del resultado (que se sigue sellando en `checkoutStartedAt`) y cualquier
 *   otro clic suyo —correo, su cuenta— desde que hizo el diagnóstico.
 * - **Le escribiste**: alguien del equipo abrió WhatsApp con ella desde el CRM
 *   después del diagnóstico.
 *
 * Los clics anteriores al diagnóstico no cuentan: hablan de otra conversación.
 */

export type WhatsAppMarks = {
  /** La persona fue a WhatsApp. */
  leadAt: Date | null;
  /** El equipo le escribió por WhatsApp desde el CRM. */
  staffAt: Date | null;
};

const latest = (...dates: (Date | null | undefined)[]): Date | null => {
  let best: Date | null = null;
  for (const d of dates) {
    if (d && (!best || d > best)) best = d;
  }
  return best;
};

const since = (date: Date | null | undefined, from: Date): Date | null =>
  date && date >= from ? date : null;

export function combineWhatsAppMarks(input: {
  diagnosticCreatedAt: Date;
  /** «Pulsó Hablar con Dayana» en el resultado. */
  checkoutStartedAt: Date | null;
  /** Último clic de la persona en un diagnóstico concreto. */
  diagnosticLeadAt?: Date | null;
  /** Último clic de la persona en cualquier sitio (correo, su cuenta…). */
  contactLeadAt?: Date | null;
  /** Último clic del equipo sobre la persona. */
  contactStaffAt?: Date | null;
}): WhatsAppMarks {
  const from = input.diagnosticCreatedAt;
  return {
    leadAt: latest(
      input.checkoutStartedAt,
      since(input.diagnosticLeadAt, from),
      since(input.contactLeadAt, from),
    ),
    staffAt: since(input.contactStaffAt, from),
  };
}
