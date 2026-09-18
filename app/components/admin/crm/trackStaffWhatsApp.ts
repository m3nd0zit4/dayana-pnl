/**
 * Registra que alguien del equipo abrió WhatsApp con un contacto desde el CRM.
 * Va en el `onClick` del enlace sin `preventDefault`: WhatsApp se abre igual
 * aunque el registro falle.
 */
export const trackStaffWhatsApp = (
  contactId: string,
  source: string,
  diagnosticId?: string,
): void => {
  void fetch(`/api/admin/contacts/${contactId}/whatsapp`, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, ...(diagnosticId ? { diagnosticId } : {}) }),
  }).catch(() => {});
};
