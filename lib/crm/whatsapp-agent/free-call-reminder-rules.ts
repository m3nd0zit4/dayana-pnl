import { getTimeLabelInTz } from "@/lib/datetime/zoned-time";
import { personFirstName } from "@/lib/person-name";
import { fillVars } from "../whatsapp-outbound-plan";
import { polishReply } from "./wording";

/**
 * El recordatorio de la llamada gratis una hora antes (pedido de la dueña):
 * «hoy a las 6:15 p. m. Dayana te llamará por WhatsApp a este número, ten a
 * mano un espacio tranquilo». Reglas puras; el envío está en
 * `appointments.ts` (`sendSoonReminders`).
 *
 * - Solo la llamada GRATIS (sin Meet: Dayana llama por WhatsApp). Una sesión
 *   pagada tiene su recordatorio de 24 h y nada más.
 * - Sale `minutesBefore` antes (60 por defecto). Como el reloj pasa cada 5–10
 *   minutos, se manda en cuanto la cita queda a `minutesBefore + 10` minutos
 *   o menos, y todavía si el reloj llega tarde, hasta 15 minutos antes (más
 *   cerca ya es la sala de espera).
 * - Si se agendó poco antes (menos de `minutesBefore + 30` minutos antes de la
 *   hora), no hace falta: la confirmación de la cita acaba de decirle la hora.
 */

/** Se manda hasta este tiempo antes de la llamada (si el reloj llega tarde). */
export const SOON_LAST_MIN = 15;
/** Y como mucho esto antes de lo pedido (el reloj no pasa justo a la hora). */
export const SOON_EARLY_MIN = 10;
/** Agendada con menos de `minutesBefore` + esto de antelación: no hace falta. */
export const BOOKED_LATE_MARGIN_MIN = 30;

export const FREE_CALL_REMINDER_MIN = 30;
export const FREE_CALL_REMINDER_MAX = 180;

/** Los minutos de antelación, siempre entre 30 y 180 (un dato raro no apaga el recordatorio). */
export const clampReminderMinutes = (v: number): number =>
  Math.min(FREE_CALL_REMINDER_MAX, Math.max(FREE_CALL_REMINDER_MIN, Math.round(v)));

/**
 * El texto de siempre, con la voz de la asistente (Dayana llama, no «te llamo
 * yo»), serio y amable: sin apodos ni corazones, y sin «lista/listo» (no se
 * adivina el género). `{{nombre}}` y `{{hora}}` se reemplazan al enviar.
 */
export const DEFAULT_FREE_CALL_REMINDER =
  "Hola {{nombre}} 🙏 Te recuerdo que hoy a las {{hora}} Dayana te llamará por WhatsApp a este número para tu llamada gratis. Por favor ten a mano un espacio tranquilo para que puedan hablar con calma.";

/** Entre qué horas de inicio toca mandarlo ahora (para la consulta). */
export const soonReminderWindow = (now: Date, minutesBefore: number): { from: Date; to: Date } => ({
  from: new Date(now.getTime() + SOON_LAST_MIN * 60_000),
  to: new Date(now.getTime() + (clampReminderMinutes(minutesBefore) + SOON_EARLY_MIN) * 60_000),
});

export type SoonReminderDecision =
  | { kind: "send" }
  /** Falta todavía: lo manda una pasada posterior. */
  | { kind: "not_yet" }
  /** Ya es muy tarde (menos de 15 min): no se manda. */
  | { kind: "too_late" }
  /** No hace falta y se marca para no revisarla más. */
  | { kind: "skip"; reason: string };

export const soonReminderDecision = (input: {
  startsAt: Date;
  /** Cuándo se agendó (la reserva de la IA o, si no, cuando el reloj la vio por primera vez). */
  bookedAt: Date | null;
  now: Date;
  minutesBefore: number;
}): SoonReminderDecision => {
  const { from, to } = soonReminderWindow(input.now, input.minutesBefore);
  const start = input.startsAt.getTime();
  if (start > to.getTime()) return { kind: "not_yet" };
  if (start < from.getTime()) return { kind: "too_late" };
  const minutes = clampReminderMinutes(input.minutesBefore);
  if (input.bookedAt) {
    const notice = (start - input.bookedAt.getTime()) / 60_000;
    if (notice < minutes + BOOKED_LATE_MARGIN_MIN) {
      return { kind: "skip", reason: `Se agendó ${Math.max(0, Math.round(notice))} min antes: la confirmación ya le dijo la hora.` };
    }
  }
  return { kind: "send" };
};

/** `{nombre}` (una llave) también vale: así lo escribiría cualquiera en Ajustes. */
const normalizePlaceholders = (text: string) => text.replace(/(?<!\{)\{\s*(nombre|hora)\s*\}(?!\})/g, "{{$1}}");

/**
 * El mensaje que recibe la persona: la hora con a. m./p. m. en SU zona, el
 * nombre solo si es un nombre de persona (sin nombre: «Hola 🙏 …», sin
 * espacios de más). Pasa por el mismo filtro de tono que las respuestas de la
 * IA: si alguien escribe un 💛 o un «querida» en Ajustes, no sale.
 */
export const freeCallReminderText = (input: {
  template?: string | null;
  name: string | null | undefined;
  startsAt: Date;
  timeZone: string;
}): string => {
  const template = input.template?.trim() || DEFAULT_FREE_CALL_REMINDER;
  const text = fillVars(normalizePlaceholders(template), {
    nombre: personFirstName(input.name) ?? "",
    hora: getTimeLabelInTz(input.startsAt, input.timeZone),
  });
  return polishReply(text);
};
