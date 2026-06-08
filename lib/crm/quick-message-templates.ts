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
