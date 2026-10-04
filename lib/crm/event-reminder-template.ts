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

/**
 * Las de horarios por país (`event-template-vars.ts`). `evento_acceso` es de
 * UTILIDAD (a quien se inscribió o pagó: confirmación y recordatorio de 24 h);
 * las de invitación, de MARKETING. La de imagen se crea a mano en el Hub.
 */
export const EVENT_ACCESS_TEMPLATE_KEY = "evento_acceso";
export const EVENT_INVITATION_TEMPLATE_KEY = "evento_invitacion";
export const EVENT_INVITATION_IMAGE_TEMPLATE_KEY = "evento_invitacion_imagen";

/** Las que el CRM manda solas a aprobar (reloj de eventos, abrir un evento o taller). */
export const EVENT_TEMPLATE_KEYS_TO_ENSURE = [
  EVENT_REMINDER_UTILITY_TEMPLATE_KEY,
  EVENT_ACCESS_TEMPLATE_KEY,
  EVENT_INVITATION_TEMPLATE_KEY,
];

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
 * Las cuatro de antes, retiradas, y las que las reemplazan. Su fila queda de
 * respaldo y nunca se vuelven a mandar a aprobar.
 */
export const RETIRED_TEMPLATES: Record<string, string[]> = {
  evento_gratis_invitacion: [EVENT_INVITATION_TEMPLATE_KEY],
  taller_invitacion: [EVENT_INVITATION_TEMPLATE_KEY],
  // El de 24 h pasa a `evento_acceso`; el de 1 h, a la corta de utilidad.
  [EVENT_REMINDER_FALLBACK_TEMPLATE_KEY]: [EVENT_ACCESS_TEMPLATE_KEY, EVENT_REMINDER_UTILITY_TEMPLATE_KEY],
  taller_recordatorio: [EVENT_ACCESS_TEMPLATE_KEY],
};

/** Las que el CRM solo usa si Meta las aprueba como UTILITY (los recordatorios). */
const UTILITY_ONLY = new Set([EVENT_ACCESS_TEMPLATE_KEY, EVENT_REMINDER_UTILITY_TEMPLATE_KEY]);

/**
 * La nueva ya la usa el CRM: aprobada, y como UTILITY si es de las de
 * recordatorio (si Meta la pasa a Marketing, los recordatorios siguen con la
 * de antes, así que esa no se puede quitar).
 */
export const templateInUse = (key: string, rows: TemplateBilling[]): boolean => {
  const row = rows.find((t) => t.key === key);
  return UTILITY_ONLY.has(key) ? isApprovedUtility(row) : isTemplateApproved(row);
};

/** Una retirada se puede quitar de WhatsApp: todas sus reemplazantes ya están en uso. */
export const retiredTemplateRemovable = (key: string, rows: TemplateBilling[]): boolean =>
  (RETIRED_TEMPLATES[key] ?? []).every((k) => templateInUse(k, rows));

/**
 * La clave del recordatorio. El de 24 h: `evento_acceso` (con los horarios por
 * país) si Meta la aprobó como UTILITY. El de 1 h (y el de 24 h mientras
 * tanto): la corta de utilidad si Meta la aprobó como UTILITY; si no, la de
 * siempre.
 */
export const preferredEventReminderTemplateKey = (
  templates: TemplateBilling[],
  pass: "24h" | "1h" = "1h"
): string => {
  const approved = (key: string) => isApprovedUtility(templates.find((t) => t.key === key));
  if (pass === "24h" && approved(EVENT_ACCESS_TEMPLATE_KEY)) return EVENT_ACCESS_TEMPLATE_KEY;
  return approved(EVENT_REMINDER_UTILITY_TEMPLATE_KEY)
    ? EVENT_REMINDER_UTILITY_TEMPLATE_KEY
    : EVENT_REMINDER_FALLBACK_TEMPLATE_KEY;
};
