import { defineDynamic, defineInstructions } from "eve/instructions";

/**
 * Grounds the model in the real current date and time.
 *
 * The model has no clock — without this it resolves "mañana", "esta semana",
 * "el próximo martes" against whatever date its training happens to imply,
 * which can land months away from today in either direction. That is exactly
 * what created a calendar event for 2026-03-31 when asked for "a meeting"
 * with no explicit date: the write itself was correct, the date fed into it
 * was wrong.
 *
 * Re-resolves on every turn (not just session start) so a thread left open
 * for days doesn't silently drift back to whatever day the session began.
 */
const currentDateInstructions = () => {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  // ISO with the Bogota offset, e.g. 2026-07-29T14:32:00-05:00 — the exact
  // shape create_calendar_event/update_calendar_event expect for startIso/
  // endIso, so the model has a working example to build relative dates from.
  const isoBogota = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(now)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {} as Record<string, string>);
  const iso = `${isoBogota.year}-${isoBogota.month}-${isoBogota.day}T${isoBogota.hour}:${isoBogota.minute}:${isoBogota.second}-05:00`;

  return defineInstructions({
    markdown: `Hoy es ${formatted} (zona horaria America/Bogota, UTC-5), es decir ${iso} en ISO 8601. Usa esta fecha, no la de tu entrenamiento, para resolver cualquier referencia relativa ("mañana", "el próximo martes", "esta semana", "en 3 días") antes de llamar a cualquier tool que reciba una fecha — especialmente \`create_calendar_event\`, \`update_calendar_event\`, \`sync_therapy_session_to_calendar\`, \`schedule_therapy_session\` y \`list_calendar_events\`. Si el operador no da una fecha explícita para agendar algo, confírmala en una frase antes de escribir — no asumas en silencio.`,
  });
};

export default defineDynamic({
  events: {
    "turn.started": () => currentDateInstructions(),
  },
});
