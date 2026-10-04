/**
 * La hora de un evento en cada país, calculada desde su fecha. Puro: lo usan
 * las plantillas de WhatsApp (una variable por región), la vista previa en
 * texto y las pruebas.
 *
 * Cada región tiene su zona IANA real, así que el horario de verano sale bien
 * para ESA fecha (Chile, Estados Unidos y Europa cambian en meses distintos).
 * WhatsApp no deja saltos de línea dentro de una variable: por eso cada línea
 * es texto fijo de la plantilla y solo la hora es variable.
 */

export type ScheduleRegion = {
  /** Nombre de la variable de la plantilla. */
  var: string;
  tz: string;
  /** Lo que va antes de la hora (texto fijo de la plantilla). */
  label: string;
};

/** La zona de referencia: la fecha del mensaje es la de Colombia. */
export const SCHEDULE_REFERENCE_TZ = "America/Bogota";

/** El orden de las líneas, en las plantillas y en la vista previa. */
export const SCHEDULE_REGIONS: readonly ScheduleRegion[] = [
  { var: "hora_co", tz: "America/Bogota", label: "🇨🇴 🇵🇪 🇪🇨 🇵🇦" },
  { var: "hora_mx", tz: "America/Mexico_City", label: "🇲🇽 🇨🇷 🇬🇹 🇸🇻 🇭🇳 🇳🇮" },
  { var: "hora_ve", tz: "America/Caracas", label: "🇻🇪 🇧🇴 🇩🇴 🇵🇷" },
  { var: "hora_cl", tz: "America/Santiago", label: "🇨🇱" },
  { var: "hora_ar", tz: "America/Argentina/Buenos_Aires", label: "🇦🇷 🇺🇾 🇧🇷 🇵🇾" },
  { var: "hora_us_este", tz: "America/New_York", label: "🇺🇸 Costa Este" },
  { var: "hora_us_centro", tz: "America/Chicago", label: "🇺🇸 Zona Central" },
  { var: "hora_us_montana", tz: "America/Denver", label: "🇺🇸 Zona Montaña" },
  { var: "hora_us_oeste", tz: "America/Los_Angeles", label: "🇺🇸 Costa Oeste" },
  { var: "hora_eu", tz: "Europe/Madrid", label: "🇪🇸 🇩🇪 🇫🇷 🇮🇹 🇨🇭 🇧🇪 🇳🇱" },
  { var: "hora_uk", tz: "Europe/London", label: "🇬🇧 🇵🇹" },
];

export const SCHEDULE_VAR_NAMES: readonly string[] = SCHEDULE_REGIONS.map((r) => r.var);

/** Sin hora todavía (`startsAtHasTime` en false). */
export const SCHEDULE_TBD = "por confirmar";

const SEPARATOR = " ➜ ";

/** Intl mete espacios duros en «a. m.»: fuera, como en el resto del CRM. */
const plain = (s: string) => s.replace(/\s/g, " ");

/** «9:30 a. m.», como las etiquetas de hora del CRM (`eventDateLabel`). */
const timeLabel = (d: Date, tz: string) =>
  plain(new Intl.DateTimeFormat("es-CO", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d));

/** «2026-10-04»: para comparar días entre zonas. */
const dayKey = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** «lun 5». */
const shortDay = (d: Date, tz: string) => {
  const parts = new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "short", day: "numeric" }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday").replace(/\.$/, "")} ${get("day")}`;
};

/**
 * Una hora por región. Si allí ya es otro día que en Colombia, lo dice:
 * «2:30 a. m. (lun 5)». Sin hora, todas «por confirmar».
 */
export const scheduleVars = (
  startsAt: Date | null,
  opts: { hasTime?: boolean } = {}
): Record<string, string> => {
  const known = startsAt && opts.hasTime !== false;
  const reference = known ? dayKey(startsAt, SCHEDULE_REFERENCE_TZ) : "";
  return Object.fromEntries(
    SCHEDULE_REGIONS.map((r) => {
      if (!known) return [r.var, SCHEDULE_TBD];
      const time = timeLabel(startsAt, r.tz);
      return [r.var, dayKey(startsAt, r.tz) === reference ? time : `${time} (${shortDay(startsAt, r.tz)})`];
    })
  );
};

/** Las líneas de la plantilla, con {{hora_co}}… en vez de la hora. */
export const scheduleTemplateLines = (): string =>
  SCHEDULE_REGIONS.map((r) => `${r.label}${SEPARATOR}{{${r.var}}}`).join("\n");

/** Las mismas líneas ya con la hora, en texto plano (vista previa, texto libre). */
export const scheduleBlock = (startsAt: Date | null, opts: { hasTime?: boolean } = {}): string => {
  const vars = scheduleVars(startsAt, opts);
  return SCHEDULE_REGIONS.map((r) => `${r.label}${SEPARATOR}${vars[r.var]}`).join("\n");
};
