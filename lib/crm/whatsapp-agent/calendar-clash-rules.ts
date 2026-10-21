import { getTimeLabelInTz } from "@/lib/datetime/zoned-time";
import { personFirstName } from "@/lib/person-name";

/**
 * Choque en la agenda (Estefania, 21-oct-2026): la asistente le agendó la
 * llamada gratis el viernes 17 a las 11:53 para el miércoles 10:30, cuando esa
 * hora estaba libre; unos minutos después Dayana puso «live» de 10:15 a 12:15
 * encima. Nadie lo notó en cuatro días: le llegaron el recordatorio de 24 h y
 * el de «hoy a las 10:30 Dayana te llamará», y a las 10:30 Dayana estaba en
 * el live.
 *
 * Regla de la dueña: en cuanto el calendario muestra el choque, se le avisa a
 * Dayana (suena + «Te toca») y ella decide (mover una de las dos o dejarlo).
 * Una vez por choque: si lo arregla y vuelve a chocar con otra cosa, se avisa
 * de nuevo.
 *
 * Puro: con qué choca, qué hacer y el aviso.
 */

export type ClashEvent = { eventId: string; title: string; start: number; end: number };

/** El primer evento (otro que la propia cita) que se monta encima de la llamada. */
export const findClash = (call: { eventId: string; start: number; end: number }, events: ClashEvent[]): ClashEvent | null =>
  events
    .filter((e) => e.eventId !== call.eventId && e.start < call.end && e.end > call.start)
    .sort((a, b) => a.start - b.start)[0] ?? null;

export type ClashStep =
  /** Choque nuevo (o con otro evento): se avisa y se guarda. */
  | { kind: "notify"; clash: ClashEvent }
  /** Ya se avisó de este mismo choque. */
  | { kind: "keep" }
  /** Ya no choca: se borra lo guardado (sin aviso). */
  | { kind: "clear" }
  | { kind: "none" };

export const clashStep = (input: { clash: ClashEvent | null; notifiedEventId: string | null }): ClashStep => {
  if (input.clash) return input.clash.eventId === input.notifiedEventId ? { kind: "keep" } : { kind: "notify", clash: input.clash };
  return input.notifiedEventId ? { kind: "clear" } : { kind: "none" };
};

const dayLabel = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("es-CO", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(d);

/** El aviso para Dayana: quién, cuándo y con qué choca, en su zona. */
export const clashNotice = (input: {
  name: string | null | undefined;
  callStart: Date;
  clash: { title: string; start: Date; end: Date };
  timeZone: string;
}): { title: string; body: string } => {
  const who = personFirstName(input.name) ?? "una persona";
  const at = `${dayLabel(input.callStart, input.timeZone)}, ${getTimeLabelInTz(input.callStart, input.timeZone)}`;
  const what = input.clash.title.trim() || "otro evento";
  const span = `${getTimeLabelInTz(input.clash.start, input.timeZone)}–${getTimeLabelInTz(input.clash.end, input.timeZone)}`;
  return {
    title: `Choque en tu agenda: llamada gratis de ${who}`,
    body: `La llamada del ${at} cae dentro de «${what}» (${span}). Mueve una de las dos en tu calendario o reagéndala desde el chat.`,
  };
};
