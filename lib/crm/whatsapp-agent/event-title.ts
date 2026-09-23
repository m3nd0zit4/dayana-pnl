/**
 * Título de una cita en el Google Calendar de Dayana, con la forma que ella
 * usa: `X/Y Nombre +teléfono`.
 *
 * - `X/Y`: número de la sesión que se agenda y total del paquete (`3/10`).
 *   Sin paquete activo, o para la consulta gratis: `0/0`.
 * - Nombre: el del CRM, si no el que dijo en el chat, si no el de su perfil de
 *   WhatsApp. Sin ninguno, solo el teléfono.
 */
export const buildEventTitle = (input: {
  name: string | null;
  phone: string;
  /** Paquete activo de la persona, si tiene. */
  enrollment?: { sessionsUsed: number; sessionsTotal: number | null } | null;
  /** La consulta gratis siempre va 0/0, aunque tenga paquete. */
  freeCall?: boolean;
}): string => {
  const phone = `+${input.phone.replace(/\D/g, "")}`;
  const e = input.enrollment;
  const counter =
    !input.freeCall && e && e.sessionsTotal && e.sessionsTotal > 0
      ? `${Math.min(e.sessionsUsed + 1, e.sessionsTotal)}/${e.sessionsTotal}`
      : "0/0";
  const name = input.name?.replace(/\s+/g, " ").trim();
  return [counter, name, phone].filter(Boolean).join(" ");
};

/** ¿Es la consulta gratis? Por el nombre del servicio o por ser de 15 min o menos. */
export const isFreeCallService = (service: string, minutes: number): boolean =>
  /gratis|valoraci[oó]n|15\s*min/i.test(service) || minutes <= 15;
