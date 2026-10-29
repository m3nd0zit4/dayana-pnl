import { isFreeCallAppointment } from "./event-title";
import { personFirstName } from "@/lib/person-name";
import { foldForSearch } from "../search-normalize";
import { timesIn } from "./promise-guard";

/**
 * La sala de espera de la llamada gratis (pedido de la dueña), en reglas
 * puras. Dayana hace la llamada gratis por WhatsApp, así que no hay forma de
 * ver si está en una llamada: se deduce del calendario.
 *
 * Cuando una persona con la llamada gratis agendada escribe cerca de su hora y
 * Dayana todavía no ha empezado con ella:
 * - si Dayana está en otra cita o reunión (algo en el calendario cruza este
 *   momento, o acaba de terminar): «Dayana está terminando una reunión, por
 *   favor espérala unos 5 minutos»;
 * - si no está ocupada pero ya es la hora: «ya le aviso a Dayana».
 *
 * Solo para la llamada GRATIS (una sesión pagada no recibe estos mensajes), a
 * lo sumo dos avisos por cita, con al menos 5 minutos entre uno y otro.
 */

export type WaitingConfig = {
  /** Minutos antes de la hora en que ya cuenta. */
  beforeMin: number;
  /** Minutos después de la hora en que todavía cuenta. */
  afterMin: number;
  /** Una reunión que terminó hace estos minutos o menos todavía «está terminando». */
  justEndedMin: number;
  maxNotices: number;
  /** Minutos mínimos entre dos avisos de la misma cita. */
  minGapMin: number;
};

export const DEFAULT_WAITING: WaitingConfig = { beforeMin: 10, afterMin: 30, justEndedMin: 5, maxNotices: 2, minGapMin: 5 };

export type WaitingAppointment = {
  startsAt: Date;
  endsAt: Date;
  sessionsLabel: string | null;
  bookingService?: string | null;
  /** Ya se sabe cómo terminó (Dayana marcó «Hablaron» / «No contestó», o el chat lo dijo). */
  callOutcome?: string | null;
  /** Ya se le mandó el mensaje para reagendar. */
  rescheduleSentAt?: Date | null;
};

export type WaitingDecision =
  | { kind: "busy"; reason: string }
  | { kind: "not_started"; reason: string }
  /** `holdAi`: es la hora de su llamada y ya se le avisó (o Dayana ya empezó): la IA no se pone a conversar. */
  | { kind: "none"; reason: string; holdAi?: boolean };

export const decideWaiting = (input: {
  now: Date;
  appointment: WaitingAppointment | null;
  /** Lo ocupado del calendario cerca de ahora (sin esta misma cita). */
  busy: { start: Date; end: Date }[];
  /** Lo último que Dayana le escribió a esta persona (no la IA, no masivos). */
  lastDayanaAt: Date | null;
  notices: { count: number; lastAt: Date | null };
  config?: WaitingConfig;
}): WaitingDecision => {
  const cfg = input.config ?? DEFAULT_WAITING;
  const a = input.appointment;
  if (!a) return { kind: "none", reason: "sin cita cerca" };
  if (!isFreeCallAppointment(a)) return { kind: "none", reason: "no es la llamada gratis" };
  // La llamada ya pasó (Fernanda, 19-oct: Dayana marcó «No contestó», le
  // llegaron horas para reagendar, eligió «22 de octubre» y recibió «ya le
  // aviso a Dayana. En un momento te llama»): la IA contesta como siempre.
  if (a.callOutcome || a.rescheduleSentAt) return { kind: "none", reason: "la llamada ya se decidió" };

  const now = input.now.getTime();
  const start = a.startsAt.getTime();
  if (now < start - cfg.beforeMin * 60_000 || now > start + cfg.afterMin * 60_000) {
    return { kind: "none", reason: "fuera de la hora de la cita" };
  }
  // Dayana ya le escribió cerca de la hora: está con ella.
  if (input.lastDayanaAt && input.lastDayanaAt.getTime() >= start - cfg.beforeMin * 60_000) {
    return { kind: "none", reason: "Dayana ya empezó con ella", holdAi: true };
  }
  if (input.notices.count >= cfg.maxNotices) return { kind: "none", reason: "ya se le avisó", holdAi: true };
  if (input.notices.lastAt && now - input.notices.lastAt.getTime() < cfg.minGapMin * 60_000) {
    return { kind: "none", reason: "se le avisó hace muy poco", holdAi: true };
  }

  const busyNow = input.busy.some((b) => {
    const s = b.start.getTime();
    const e = b.end.getTime();
    if (s === start) return false; // la misma cita
    return (s <= now && now < e) || (e <= now && now - e <= cfg.justEndedMin * 60_000);
  });
  if (busyNow) return { kind: "busy", reason: "Dayana está en otra cita o reunión" };
  if (now >= start - 2 * 60_000) return { kind: "not_started", reason: "ya es la hora y Dayana no ha empezado" };
  return { kind: "none", reason: "todavía no es la hora" };
};

/**
 * Lo que escribe a la hora de su llamada gratis (Xime, 22-oct). La sala de
 * espera callaba TODO lo que llegara en esa media hora (`free_call_now`): su
 * «si mañana esta perfecto a esa hora» —el sí a otra hora que le propuso la
 * asistente— no tuvo respuesta, y después el mensaje de «no contestó» le mandó
 * otras horas. Ahora:
 *
 * - `move`: habla de OTRA hora (pide reagendar, nombra otro día u otra hora,
 *   dice que sí o elige de las horas que le acabamos de ofrecer). Se atiende ya
 *   como un turno de agenda: esperar solo le quita la hora y Dayana no la va a
 *   encontrar en esta llamada.
 * - `now`: es de la llamada de ahora («ya estoy lista», «¿me va a llamar?»,
 *   «¿sigues ahí?», un saludo, «ok», «gracias»). Como siempre: el aviso de la
 *   sala de espera o nada, la IA no conversa.
 * - `later`: otra cosa (una pregunta que no es de la llamada). No se contesta
 *   encima de la llamada: queda para cuando pase su hora («pendientes» del
 *   reloj la retoma si nadie le contestó).
 *
 * `offeredHours`: lo último nuestro antes de lo que escribió le ofrecía horas
 * (`offeredHoursBefore`). `todayWeekdays`: el día de hoy («jueves»), que no es «otro día».
 */
export type WindowReply = "move" | "now" | "later";

const MOVE_WORDS =
  /\b(reagend\w*|re agend\w*|reprogram\w*|posponer|pospon\w*|aplazar|aplac\w*|otro dia|otra (hora|fecha)|otro horario|otro momento|imprevisto|cambiar (la|mi|de|el) (cita|llamada|hora|fecha|dia|horario)|mover (la|mi) (cita|llamada)|no (voy|vamos) a (poder|estar|alcanzar)|no (podre|podria|alcanzo|alcanzare|estare)|se me (complico|presento|atraveso|cruzo))\b/;
const DAY_WORDS = /\b(pasado manana|la (otra|proxima) semana|\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))\b|(?<!\b(?:la|pasado|esta)\s)\bmanana\b/;
const WEEKDAY_WORDS = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/g;
/** De la llamada de ahora: está lista o esperando, pregunta si la llaman, algo de la conexión. */
const CALL_NOW =
  /\b(llam\w*|marc\w*|esper\w*|list[ao]s?|conect\w*|disponible|ahi|aqui|aca|whatsapp|videollamada|contest\w*|timbr\w*|escucho|escuchas|se corto|se cayo|ya voy|ya casi|en camino|un momento|un minuto|un ratito|cinco minutos|\d+ minutos|ya estoy|ya es la hora|ya son las|salgo|llego|cita)\b/;
/** Un saludo, un «ok», un «gracias», un «amén», emojis: nada que contestar fuera de la llamada. */
const COURTESY = new Set(
  "hola holi buenas buenos buen dia dias tardes tarde noches noche ok okey okay oki vale gracias mil muchas listo si sii perfecto perfecta bueno amen dios bendiciones bendigo te le dale claro genial excelente super ya muy y senora dayana doctora dra".split(
    " "
  )
);
const YES_OR_CHOICE = /^(si+|ok+|okey|okay|vale|dale|listo|perfect[oa]|claro|bueno|de acuerdo|esta bien|me sirve|me queda|[1-9]|la [1-9]|opcion [1-9])\b|\b(primera|segunda|tercera|ultima|si+|perfect[oa]|me sirve|me queda bien|de acuerdo)\b/;

export const callWindowReply = (input: { text: string; offeredHours: boolean; todayWeekdays?: string[] }): WindowReply => {
  const t = foldForSearch(input.text).replace(/[^\p{L}\p{N}:?¿\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!t) return "now";
  const today = new Set(input.todayWeekdays ?? []);
  const otherWeekday = [...t.matchAll(WEEKDAY_WORDS)].some((m) => !today.has(m[1]));
  if (MOVE_WORDS.test(t) || DAY_WORDS.test(t) || otherWeekday) return "move";
  if (CALL_NOW.test(t)) return "now";
  if (input.offeredHours && YES_OR_CHOICE.test(t)) return "move";
  if (timesIn(t).length > 0) return "move";
  if (t.split(" ").every((w) => COURTESY.has(w))) return "now";
  return "later";
};

const firstName = (name: string | null | undefined) => personFirstName(name) ?? "";

/** Lo que se le dice a la persona, con la voz de la asistente. */
export const waitingMessage = (kind: "busy" | "not_started", name: string | null | undefined): string => {
  const hi = firstName(name) ? `Hola ${firstName(name)}` : "Hola";
  return kind === "busy"
    ? `${hi} 🙏 Dayana está terminando una reunión. Por favor espérala unos 5 minutos y te llama por aquí.`
    : `${hi}, ya le aviso a Dayana. En un momento te llama por aquí 🙏`;
};
