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
  const c = rest.match(/^(\d{1,3})\s*\/\s*(\d{1,3})\b\s*/);
  if (c) {
    counter = `${c[1]}/${c[2]}`;
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
