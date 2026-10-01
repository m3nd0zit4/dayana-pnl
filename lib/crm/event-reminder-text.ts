import { getTimeZones } from "@vvo/tzdb";
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from "libphonenumber-js";
import { suggestTimezoneForCountryOrNull } from "@/lib/contact-timezone";
import { DEFAULT_OPERATIONAL_TZ } from "@/lib/datetime/zoned-time";
import { countryName, isValidTimezone, MULTI_ZONE_COUNTRIES } from "./whatsapp-agent/booking-time";

/**
 * Qué dice el recordatorio de WhatsApp del evento gratuito. Puro (sin base de
 * datos): lo usan el barrido del cron, el envío manual y las pruebas.
 *
 * La plantilla aprobada (`evento_gratis_recordatorio`) dice «te recuerdo que
 * {{evento}} es el {{fecha}}», así que `fecha` empieza siempre por el día de
 * la semana y nunca lleva saltos de línea (Meta rechaza parámetros con ellos).
 */

export type EventWaPass = "24h" | "1h";

const HOUR_MS = 60 * 60 * 1000;

/** La zona en la que se le habla a la persona y su país (para nombrarlo). */
export type ReminderZone = { tz: string; countryIso: string | null };

let countryByZoneCache: Map<string, string> | null = null;

/** País de una zona IANA, alias incluidos («America/Bogota» → CO). */
const countryOfZone = (tz: string): string | null => {
  if (!countryByZoneCache) {
    const map = new Map<string, string>();
    for (const z of getTimeZones()) {
      if (!z.countryCode) continue;
      map.set(z.name, z.countryCode.toUpperCase());
      for (const alias of z.group ?? []) map.set(alias, z.countryCode.toUpperCase());
    }
    countryByZoneCache = map;
  }
  return countryByZoneCache.get(tz) ?? null;
};

/**
 * La zona de la persona. `Contact.timezone` vale «America/Bogota» por defecto,
 * así que Bogotá ahí no dice nada: solo una zona distinta cuenta como elegida.
 * Si no, se deduce del número (+52 → México). Si tampoco, la de Dayana.
 */
export const reminderZone = (
  contact: { timezone?: string | null; phoneE164?: string | null; phoneCountryIso?: string | null },
  opTz: string = DEFAULT_OPERATIONAL_TZ
): ReminderZone => {
  const explicit = contact.timezone?.trim();
  if (explicit && explicit !== DEFAULT_OPERATIONAL_TZ && isValidTimezone(explicit)) {
    return { tz: explicit, countryIso: countryOfZone(explicit) };
  }
  const iso = contact.phoneCountryIso?.trim().toUpperCase();
  if (iso) {
    const tz = suggestTimezoneForCountryOrNull(iso);
    if (tz) return { tz, countryIso: iso };
  }
  const phone = contact.phoneE164?.trim();
  const fromPhone = phone && /^\+\d{8,15}$/.test(phone) ? countryOfPhone(phone) : null;
  const tz = fromPhone ? suggestTimezoneForCountryOrNull(fromPhone) : null;
  if (fromPhone && tz) return { tz, countryIso: fromPhone };
  return { tz: opTz, countryIso: countryOfZone(opTz) };
};

/** Prefijos compartidos: el país principal (el resto, el primero por código). */
const MAIN_COUNTRY_BY_CODE: Record<string, string> = { "1": "US", "7": "RU" };

/**
 * País de un número internacional. `inferLocaleFromPhone` no sirve aquí: lee
 * el número como local del país de respaldo y a un +34 lo deja en Colombia.
 * Números que libphonenumber no da por válidos (el +52 1 viejo de México)
 * conservan el prefijo, y con eso basta para la zona.
 */
const countryOfPhone = (phoneE164: string): string | null => {
  const parsed = parsePhoneNumberFromString(phoneE164);
  if (!parsed) return null;
  if (parsed.country) return parsed.country;
  const code = parsed.countryCallingCode;
  return MAIN_COUNTRY_BY_CODE[code] ?? getCountries().find((c) => getCountryCallingCode(c) === code) ?? null;
};

/** «México»; en países con varias zonas, la ciudad si no es la principal. */
const placeName = (zone: ReminderZone): string => {
  const city = zone.tz.split("/").pop()?.replace(/_/g, " ") ?? zone.tz;
  if (!zone.countryIso) return city;
  const country = countryName(zone.countryIso);
  if (MULTI_ZONE_COUNTRIES.has(zone.countryIso) && suggestTimezoneForCountryOrNull(zone.countryIso) !== zone.tz) {
    return `${country} (${city})`;
  }
  return country;
};

/** Intl mete espacios duros en «a. m.»: fuera, para que el texto sea uniforme. */
const plain = (s: string) => s.replace(/[  ]/g, " ");

const dateParts = (d: Date, tz: string) => {
  const parts = new Intl.DateTimeFormat("es-CO", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: get("weekday"), day: get("day"), month: get("month") };
};

const timeLabel = (d: Date, tz: string) =>
  plain(new Intl.DateTimeFormat("es-CO", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d));

/** «domingo 4 de octubre» (sin coma: va detrás de «es el»). */
const longDate = (d: Date, tz: string) => {
  const p = dateParts(d, tz);
  return `${p.weekday} ${p.day} de ${p.month}`;
};

const sameLocalMoment = (d: Date, a: string, b: string) =>
  longDate(d, a) === longDate(d, b) && timeLabel(d, a) === timeLabel(d, b);

/**
 * «domingo 4 de octubre a las 9:30 a. m. (hora de Colombia), 8:30 a. m. en
 * México». La hora local solo se añade si de verdad es otra (Perú tiene la
 * misma que Colombia: repetirla confunde). Si allí ya es otro día, lo dice.
 */
export const eventFecha = (input: {
  startsAt: Date;
  startsAtHasTime: boolean;
  pass: EventWaPass;
  opTz: string;
  zone: ReminderZone;
  /** Solo para el de 1 h enviado a mano con el evento ya empezado. */
  now?: Date;
}): string => {
  const { startsAt, opTz, zone } = input;
  if (!input.startsAtHasTime) {
    return `${longDate(startsAt, opTz)} (la hora te la confirmo pronto)`;
  }
  const opPlace = placeName({ tz: opTz, countryIso: countryOfZone(opTz) });
  let fecha = `${longDate(startsAt, opTz)} a las ${timeLabel(startsAt, opTz)} (hora de ${opPlace})`;
  if (zone.tz !== opTz && !sameLocalMoment(startsAt, zone.tz, opTz)) {
    const local = timeLabel(startsAt, zone.tz);
    const sameDay = longDate(startsAt, zone.tz) === longDate(startsAt, opTz);
    fecha += sameDay
      ? `, ${local} en ${placeName(zone)}`
      : `, ${longDate(startsAt, zone.tz)} a las ${local} en ${placeName(zone)}`;
  }
  if (input.pass === "1h") {
    const started = input.now !== undefined && input.now.getTime() >= startsAt.getTime();
    fecha += started ? " (ya empezamos, todavía puedes entrar)" : " (en 1 hora)";
  }
  return plain(fecha).replace(/\s*[\r\n]+\s*/g, " ");
};

export type EventReminderVars = { evento: string; fecha: string; enlace: string };

/** Las variables de la plantilla (sin `nombre`: lo pone el envío). */
export const eventReminderVars = (input: {
  headline: string;
  startsAt: Date;
  startsAtHasTime: boolean;
  meetUrl: string;
  pass: EventWaPass;
  opTz: string;
  zone: ReminderZone;
  now?: Date;
}): EventReminderVars => ({
  evento: `«${input.headline.replace(/\s+/g, " ").trim()}»`,
  fecha: eventFecha(input),
  enlace: input.meetUrl.trim(),
});

/**
 * Primer nombre para saludar. Hay contactos cuyo «nombre» es el teléfono o el
 * correo (formularios sin nombre): mejor no saludar con eso.
 */
export const greetingName = (full: string | null | undefined): string => {
  const first = (full ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first || /[\d@+]/.test(first)) return "";
  return first.charAt(0).toUpperCase() + first.slice(1);
};

/**
 * El texto libre para quien escribió en las últimas 24 h (gratis). Mismas
 * palabras que la plantilla, para que nadie reciba dos versiones distintas.
 */
export const eventReminderText = (input: EventReminderVars & { nombre?: string | null }): string => {
  const nombre = input.nombre?.trim();
  return `Hola${nombre ? ` ${nombre}` : ""}, te recuerdo que ${input.evento} es el ${input.fecha}. Entra aquí: ${input.enlace} Nos vemos pronto 💛`;
};

/**
 * La confirmación al inscribirse, en texto libre: mismas palabras que la
 * plantilla `evento_gratis_confirmacion`. `fecha` sale de `eventFecha` (con la
 * hora de Colombia y la de la persona si es otra).
 */
export const eventConfirmationText = (input: {
  evento: string;
  fecha: string;
  nombre?: string | null;
}): string => {
  const nombre = input.nombre?.trim();
  return `Hola${nombre ? ` ${nombre}` : ""}, quedaste inscrita en ${input.evento} el ${input.fecha}. Te mando el enlace para entrar por aquí antes de empezar.`;
};

/**
 * Las mismas ventanas que los correos (`reminderWindowOpen` del mailer):
 * - 24 h: entre 2 h y 24 h antes (quien llega más tarde lo recibe en el de 1 h).
 * - 1 h: dentro de la última hora, y solo si el evento tiene hora real.
 */
export const waReminderDue = (
  pass: EventWaPass,
  startsAt: Date | null,
  startsAtHasTime: boolean,
  now: Date
): boolean => {
  if (!startsAt) return false;
  const msToStart = startsAt.getTime() - now.getTime();
  if (msToStart <= 0) return false;
  if (pass === "24h") return msToStart > 2 * HOUR_MS && msToStart <= 24 * HOUR_MS;
  return startsAtHasTime && msToStart <= HOUR_MS;
};
