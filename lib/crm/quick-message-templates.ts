/** Plantillas del sistema (pagos, cron, campañas). No aparecen en Mensajes rápidos. */
export const SYSTEM_MESSAGE_TEMPLATE_KEYS = new Set([
  "post_payment_therapy",
  "session_reminder",
  "workshop_open",
  "lead_followup",
  "payment_confirmation",
]);

export const isQuickMessageTemplate = (key: string): boolean =>
  !SYSTEM_MESSAGE_TEMPLATE_KEYS.has(key);

/**
 * Plantillas transaccionales: las envía el flujo que puede rellenar sus
 * variables, nunca el asistente por su cuenta.
 *
 * Son las que llevan un enlace de autenticación (invitación, restablecer
 * contraseña) o afirman algo sobre el estado de la cuenta (mensualidad vencida,
 * pago confirmado, sesión agendada). Enviarlas sin los datos correctos produce
 * un correo roto o —peor— falso: un aviso de restablecimiento que nadie pidió
 * tiene la forma exacta de un phishing, y un "tu mensualidad venció" equivocado
 * es una llamada a soporte.
 *
 * OJO: esto NO es lo mismo que `SYSTEM_MESSAGE_TEMPLATE_KEYS`, que decide qué
 * aparece en Mensajes rápidos. Aquel flujo lo revisa una persona antes de
 * enviar; este no.
 */
export const TRANSACTIONAL_TEMPLATE_KEYS = new Set([
  "member_invite",
  "member_password_reset",
  "membership_payment_due",
  "membership_overdue",
  "new_recording_posted",
  "post_payment_therapy",
  "session_reminder",
  "payment_confirmation",
]);

/**
 * ¿Puede el asistente enviar esta plantilla sin supervisión?
 *
 * Lista de exclusión deliberada y no de inclusión: una plantilla nueva escrita
 * por la operadora es de marketing por defecto y debe funcionar sin tocar este
 * archivo. Lo que nunca puede colarse es una transaccional, y esas están
 * enumeradas arriba.
 */
export const isAgentSendableTemplate = (key: string): boolean =>
  !TRANSACTIONAL_TEMPLATE_KEYS.has(key);

/** Extrae los nombres de variable `{{var}}` que usa el cuerpo de una plantilla. */
export const templateVariableNames = (body: string): string[] => [
  ...new Set([...body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1])),
];

/**
 * Variables que la plantilla pide y nadie va a rellenar.
 *
 * `renderQuickMessage` solo sustituye las variables que recibe: las que falten
 * se entregan como texto literal `{{así}}` en el correo del cliente. Por eso hay
 * que comprobarlo antes de enviar y no después.
 */
export const missingTemplateVariables = (
  body: string,
  vars: Record<string, string>
): string[] =>
  templateVariableNames(body).filter(
    (name) => vars[name] == null || vars[name].trim() === ""
  );
