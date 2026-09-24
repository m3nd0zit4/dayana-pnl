import { isValidIanaTimeZone } from "@/lib/datetime/zoned-time";
import {
  DIAGNOSTIC_QUESTIONS,
  answerLabels,
  isQuestionVisible,
  type DiagnosticAnswers,
} from "@/lib/diagnostico/questions";

/**
 * Lo que se sabe de una autoevaluación antes de pasársela a la IA: qué
 * contestó, desde dónde y a qué hora de SU día. Puro (sin base de datos) para
 * poder probarlo.
 *
 * La hora importa: una autoevaluación a las 3 a. m. hora de la persona no es
 * lo mismo que una a las 10 a. m. Pero la hora del servidor no sirve y la del
 * país del teléfono tampoco siempre: mucha gente con número colombiano vive en
 * España o en Estados Unidos. Por eso se prefiere la zona del navegador, luego
 * la de la IP, y solo al final la que se deduce del teléfono.
 */

export type DayPart = "madrugada" | "mañana" | "tarde" | "noche";

export type DiagnosticSignals = {
  answers: { question: string; answer: string }[];
  profile: string | null;
  urgencyScore: number | null;
  commitmentScore: number | null;
  phoneCountry: string | null;
  ipCountry: string | null;
  ipCity: string | null;
  /** Probable país donde vive (IP si la hay, si no el del teléfono). */
  livesIn: string | null;
  /** El teléfono es de un país y la conexión de otro. */
  abroad: boolean;
  timezone: string;
  timezoneSource: "browser" | "ip" | "contact" | "default";
  localTime: string; // "03:12"
  localHour: number;
  localWeekday: string; // "domingo"
  dayPart: DayPart;
  /** Entre la medianoche y las 5 a. m. de la persona. */
  lateNight: boolean;
};

const COUNTRY_TZ: Record<string, string> = {
  CO: "America/Bogota",
  MX: "America/Mexico_City",
  PE: "America/Lima",
  EC: "America/Guayaquil",
  VE: "America/Caracas",
  CL: "America/Santiago",
  AR: "America/Argentina/Buenos_Aires",
  ES: "Europe/Madrid",
  US: "America/New_York",
  PA: "America/Panama",
  CR: "America/Costa_Rica",
  GT: "America/Guatemala",
  DO: "America/Santo_Domingo",
  BO: "America/La_Paz",
  UY: "America/Montevideo",
  PY: "America/Asuncion",
};

export const countryName = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  try {
    return new Intl.DisplayNames(["es"], { type: "region" }).of(iso.toUpperCase()) ?? iso;
  } catch {
    return iso;
  }
};

export const dayPartOf = (hour: number): DayPart =>
  hour < 5 ? "madrugada" : hour < 12 ? "mañana" : hour < 19 ? "tarde" : "noche";

export const pickTimezone = (input: {
  clientTimezone?: string | null;
  ipTimezone?: string | null;
  contactTimezone?: string | null;
  countryIso?: string | null;
}): { timezone: string; source: DiagnosticSignals["timezoneSource"] } => {
  const ok = (tz: string | null | undefined): tz is string => Boolean(tz && isValidIanaTimeZone(tz));
  if (ok(input.clientTimezone)) return { timezone: input.clientTimezone, source: "browser" };
  if (ok(input.ipTimezone)) return { timezone: input.ipTimezone, source: "ip" };
  // El contacto guarda Bogotá por defecto: solo cuenta si coincide con su país
  // o si no hay país para contradecirlo.
  const byCountry = input.countryIso ? COUNTRY_TZ[input.countryIso.toUpperCase()] : undefined;
  if (ok(input.contactTimezone) && (!byCountry || input.contactTimezone !== "America/Bogota" || byCountry === "America/Bogota"))
    return { timezone: input.contactTimezone, source: "contact" };
  if (byCountry) return { timezone: byCountry, source: "contact" };
  return { timezone: "America/Bogota", source: "default" };
};

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export const localClock = (at: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const minute = get("minute");
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    hour,
    time: `${String(hour).padStart(2, "0")}:${minute}`,
    weekday: WEEKDAYS[weekday < 0 ? 0 : weekday],
  };
};

export const buildDiagnosticSignals = (input: {
  answers: DiagnosticAnswers;
  profile: string | null;
  urgencyScore: number | null;
  commitmentScore: number | null;
  completedAt: Date;
  phoneCountry: string | null;
  contactTimezone: string | null;
  clientTimezone: string | null;
  ipCountry: string | null;
  ipCity: string | null;
  ipTimezone: string | null;
}): DiagnosticSignals => {
  const answers = DIAGNOSTIC_QUESTIONS.filter((q) => isQuestionVisible(q, input.answers))
    .map((q) => ({ question: q.prompt, answer: answerLabels(q.id, input.answers[q.id]).join(", ") }))
    .filter((a) => a.answer);
  const phoneCountry = input.phoneCountry?.toUpperCase() || null;
  const ipCountry = input.ipCountry?.toUpperCase() || null;
  const { timezone, source } = pickTimezone({
    clientTimezone: input.clientTimezone,
    ipTimezone: input.ipTimezone,
    contactTimezone: input.contactTimezone,
    countryIso: ipCountry ?? phoneCountry,
  });
  const clock = localClock(input.completedAt, timezone);
  return {
    answers,
    profile: input.profile,
    urgencyScore: input.urgencyScore,
    commitmentScore: input.commitmentScore,
    phoneCountry,
    ipCountry,
    ipCity: input.ipCity,
    livesIn: ipCountry ?? phoneCountry,
    abroad: Boolean(phoneCountry && ipCountry && phoneCountry !== ipCountry),
    timezone,
    timezoneSource: source,
    localTime: clock.time,
    localHour: clock.hour,
    localWeekday: clock.weekday,
    dayPart: dayPartOf(clock.hour),
    lateNight: clock.hour < 5,
  };
};

/** El bloque que lee la IA. */
export const describeSignals = (s: DiagnosticSignals): string => {
  const place = [s.ipCity, countryName(s.livesIn)].filter(Boolean).join(", ") || "desconocido";
  const lines = [
    `Respuestas:`,
    ...s.answers.map((a) => `- ${a.question} → ${a.answer}`),
    `Perfil calculado: ${s.profile ?? "—"} · urgencia ${s.urgencyScore ?? "—"}/10 · compromiso ${s.commitmentScore ?? "—"}/10`,
    `Desde dónde: ${place}${s.abroad ? ` (su número es de ${countryName(s.phoneCountry)}: probablemente vive fuera de su país)` : ""}`,
    `Hora local de la persona al terminar: ${s.localWeekday} ${s.localTime} (${s.dayPart}${s.lateNight ? ", MADRUGADA" : ""}; zona ${s.timezone}${s.timezoneSource === "default" ? ", supuesta" : ""})`,
  ];
  return lines.join("\n");
};
