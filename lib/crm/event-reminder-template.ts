/**
 * Qué plantilla lleva el recordatorio de un evento a quien se inscribió. Puro
 * (lo usan el reloj, los botones, los mensajes listos y el diálogo masivo).
 *
 * Meta pasó `evento_gratis_recordatorio` a MARKETING (por el tono cálido:
 * «Nos vemos pronto 💛»), y Marketing se cobra mucho más caro. Quien recibe
 * el recordatorio se inscribió y lo pidió: es UTILIDAD. Por eso existe
 * `evento_inscrita_recordatorio`, estrictamente informativa. Se usa en cuanto
 * Meta la aprueba como UTILITY; mientras tanto (o si Meta también la pasa a
 * Marketing), la de siempre. Las dos usan las mismas variables: nombre,
 * evento, fecha y enlace.
 */

export const EVENT_REMINDER_UTILITY_TEMPLATE_KEY = "evento_inscrita_recordatorio";
export const EVENT_REMINDER_UTILITY_TEMPLATE_TITLE = "Evento: recordatorio a inscritas (utilidad)";
/** La de antes, por si la de utilidad aún no está aprobada. */
export const EVENT_REMINDER_FALLBACK_TEMPLATE_KEY = "evento_gratis_recordatorio";

/** Lo que hace falta saber de una plantilla para elegirla. */
export type TemplateBilling = {
  key: string;
  metaApprovalStatus: string | null;
  metaCategory: string | null;
};

export const isTemplateApproved = (t: Pick<TemplateBilling, "metaApprovalStatus"> | null | undefined): boolean =>
  (t?.metaApprovalStatus ?? "").toUpperCase() === "APPROVED";

/** Aprobada y Meta la cobra como Utilidad. */
export const isApprovedUtility = (t: TemplateBilling | null | undefined): boolean =>
  isTemplateApproved(t) && (t?.metaCategory ?? "").toUpperCase() === "UTILITY";

/**
 * La clave del recordatorio: la de utilidad si Meta la aprobó como UTILITY;
 * si no, la de siempre.
 */
export const preferredEventReminderTemplateKey = (templates: TemplateBilling[]): string =>
  isApprovedUtility(templates.find((t) => t.key === EVENT_REMINDER_UTILITY_TEMPLATE_KEY))
    ? EVENT_REMINDER_UTILITY_TEMPLATE_KEY
    : EVENT_REMINDER_FALLBACK_TEMPLATE_KEY;
