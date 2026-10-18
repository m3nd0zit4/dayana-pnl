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

export type ParsedEventTitle = {
  /** «3/6», «0/0»… o null si el título no lo trae. */
  counter: string | null;
  name: string | null;
  /** Solo dígitos, con código de país (como lo escribió Dayana). */
  phone: string | null;
};

/**
 * Lee un título de cita: «3/6 Laura Pérez +573001234567», «Laura», «0/0 Ana +52 1 55…».
 * El número se reconoce si empieza con «+» o tiene al menos 10 dígitos seguidos
 * (con espacios o guiones).
 */
export const parseEventTitle = (title: string | null | undefined): ParsedEventTitle => {
  let rest = (title ?? "").replace(/\s+/g, " ").trim();
  let counter: string | null = null;
  // «3/6» o, como los escribe Dayana a mano, «3.6» (17-oct: «3.6 jesus terapia…»).
  // Con punto solo si parece un contador (la sesión no pasa del total): «1.5 horas» no.
  const c = rest.match(/^(\d{1,3})\s*([/.])\s*(\d{1,3})\b\s*/);
  if (c && (c[2] === "/" || (Number(c[1]) >= 1 && Number(c[1]) <= Number(c[3]) && Number(c[3]) <= 60 && !/^\s*(h|hrs?|horas?|min|minutos?)\b/i.test(rest.slice(c[0].length))))) {
    counter = `${c[1]}/${c[3]}`;
    rest = rest.slice(c[0].length);
  }
  let phone: string | null = null;
  const p = rest.match(/(\+\s*\d[\d\s-]{6,}\d|\b\d[\d\s-]{8,}\d\b)/);
  if (p) {
    const digits = p[0].replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) {
      phone = digits;
      rest = (rest.slice(0, p.index) + rest.slice((p.index ?? 0) + p[0].length)).replace(/\s+/g, " ").trim();
    }
  }
  const name = rest.replace(/^[-–·,:|\s]+|[-–·,:|\s]+$/g, "").trim() || null;
  return { counter, name, phone };
};

/** El mismo título con el número al final (`+dígitos`), sin tocar lo demás. */
export const withPhone = (title: string, phoneDigits: string): string => {
  const parsed = parseEventTitle(title);
  if (parsed.phone) return title;
  return `${title.replace(/\s+/g, " ").trim()} +${phoneDigits.replace(/\D/g, "")}`;
};

/** Nombre para comparar: minúsculas, sin tildes ni signos, espacios simples. */
export const foldName = (name: string | null | undefined): string =>
  (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * ¿El nombre del calendario corresponde a esta persona? Todas las palabras del
 * nombre del evento deben estar en el nombre de la persona («Ana» ↔ «Ana
 * María López», «Ana López» ↔ «Ana María López»).
 */
export const nameMatches = (eventName: string, personName: string): boolean => {
  const ev = foldName(eventName).split(" ").filter((w) => w.length > 1);
  const person = new Set(foldName(personName).split(" "));
  return ev.length > 0 && ev.every((w) => person.has(w));
};

/** «3/6»: una sesión de paquete. «0/0» o sin contador, no. */
export const isPackageCounter = (label: string | null | undefined): boolean => {
  const m = label?.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  return Boolean(m && Number(m[2]) > 0);
};

/** El código de una reunión de Meet («abc-defg-hij») de su enlace, o null. */
export const meetCode = (url: string | null | undefined): string | null =>
  url?.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i)?.[1]?.toLowerCase() ?? null;

/** Una llamada gratis dura esto o menos; lo que pasa de aquí es una sesión. */
export const FREE_CALL_MAX_MINUTES = 20;

/**
 * ¿Esta cita es la llamada gratis? `0/0` sola no basta: también se escribe
 * para una sesión pagada sin paquete. Cuenta como gratis si la agendó la IA
 * con un servicio gratis, o si no tiene contador de sesiones (o es `0/0`) Y
 * dura {@link FREE_CALL_MAX_MINUTES} minutos o menos.
 */
export const isFreeCallAppointment = (a: {
  sessionsLabel: string | null;
  startsAt: Date;
  endsAt: Date;
  /** Servicio con el que la agendó la IA (`WhatsAppBooking.service`), si fue ella. */
  bookingService?: string | null;
}): boolean => {
  const minutes = (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000;
  if (a.bookingService) return isFreeCallService(a.bookingService, minutes);
  const label = a.sessionsLabel?.trim();
  if (label && label !== "0/0") return false;
  return minutes > 0 && minutes <= FREE_CALL_MAX_MINUTES;
};
