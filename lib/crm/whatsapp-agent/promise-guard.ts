import { foldForSearch } from "../search-normalize";

/**
 * Lo que la asistente nunca puede prometer sin respaldo (pedido del dueño,
 * 16-oct). Se mira en código, antes de enviar, porque el modelo lo hizo igual
 * con el prompt diciéndole que no:
 *
 * - **Horas inventadas**: a «💙💙💜🩷» le ofreció «sábado 17, 10:00 a. m. o
 *   4:00 p. m.» cuando la agenda no había respondido (no sabía su país). Las
 *   horas de una llamada solo salen de `offer_free_call_slots` (o de una cita
 *   que ya existe).
 * - **Citas que no existen**: luego le dijo «Sí, queda confirmada para este
 *   sábado» sin haber agendado nada.
 * - **«Hoy mismo»**: a Valentina, «Ya le aviso a Dayana para que se comunique
 *   con ustedes hoy mismo», sin cita y sin mirar la agenda.
 *
 * Pura: `run.ts` le da lo que respalda la respuesta (las horas ofrecidas de
 * verdad y si hay una cita) y no envía si hay una falta. La usan también los
 * calificadores de la evaluación.
 */

export type PromiseBreach = "invented_slots" | "false_booking" | "same_day_promise";

/** «10:00 a. m.», «4 p.m.», «8:45 pm», «10 de la mañana» → «10:00a». */
const TIME = /\b(\d{1,2})(?::([0-5]\d))?\s*(?:([ap])\.?\s?m\b\.?|de la (manana|tarde|noche))/g;

/** Las horas que menciona un texto, normalizadas («10:00a», «4:00p»). */
export const timesIn = (text: string): string[] => {
  const out = new Set<string>();
  for (const m of foldForSearch(text).matchAll(TIME)) {
    const hour = Number(m[1]);
    if (!hour || hour > 12) continue;
    const ap = m[3] ?? (m[4] === "manana" ? "a" : "p");
    out.add(`${hour}:${m[2] ?? "00"}${ap}`);
  }
  return [...out];
};

/** Habla de agendar o de horas para una llamada o una cita («a las 6:30 p. m. te queda bien»). */
const SCHEDULING = /(llamad|cita|agend|horari|disponib|espacio|opcion|reserv|te queda bien|te sirve|que dia)/;
/** Habla de un evento, un taller o una clase: esas horas vienen de los datos, no de la agenda. */
const EVENT_CONTEXT = /(webinar|evento|taller|curso|clase|en vivo|\blive\b|grupo|sesion grupal|reprogramacion grupal)/;

/** «queda confirmada», «ya te agendé», «tu llamada está agendada», «Dayana te llama el sábado». */
const BOOKING_CLAIM =
  /(queda(s|n|ste)?|quedo|quedaria)\s+(totalmente\s+|entonces\s+)?(confirmad|agendad|reservad)|esta(s)?\s+(confirmad|agendad|reservad)|ya\s+(te\s+)?(agende|reserve|confirme)\b|\bte\s+(agende|reserve)\b|tu\s+(cita|llamada)\s+(queda|esta|quedo)\s+(confirmad|agendad|reservad|para)|dayana\s+te\s+llama(ra)?\s+(el|este|esta|manana|hoy|a\s+las|en\s+la\s+manana)/;

/**
 * «hoy mismo», «Dayana se comunica con ustedes hoy», «hoy te llama», «te
 * estará llamando en unos momentos», «te contactará en breve», «intentamos de
 * nuevo en un momento» (Samy y «la negra bella», 14-oct: nadie las llamó).
 */
const SAME_DAY =
  /hoy mismo|(se comuni\w*|te llam\w*|les llam\w*|te contact\w*|les contact\w*|te atiend\w*|los atiend\w*|te estar[a-z]* llamando)[^.?!\n]{0,40}(\bhoy\b|en unos (momentos|minutos)|en breve|en un momento|ahorita|enseguida|en seguida)|(\bhoy\b|en unos (momentos|minutos)|en breve|en un momento|ahorita)[^.?!\n]{0,30}(se comuni|te llam|les llam|te contact|te atiend)|(intentamos|lo intentamos|volvemos a intentar|te volvemos a llamar) (de nuevo|otra vez|en un momento|mas tarde|ahorita)/;

export type PromiseCheck = {
  /** Lo que recibiría la persona. */
  text: string;
  /**
   * Lo que respalda las horas: las etiquetas que devolvió la agenda
   * (`offer_free_call_slots`, en esta vuelta o hace poco) y las horas de sus
   * citas, como texto («viernes, 16 de octubre, 8:45 p. m. (tu hora) · …»).
   */
  backing: string[];
  /** Hay una cita de verdad: agendada en esta vuelta o activa en el calendario. */
  hasBooking: boolean;
  /** Esa cita es hoy. */
  bookingToday: boolean;
};

export type PromiseVerdict = { breach: PromiseBreach; detail: string } | null;

/** ¿La respuesta promete algo que nada respalda? `null` si está bien. */
export const promiseBreach = (input: PromiseCheck): PromiseVerdict => {
  const text = foldForSearch(input.text);
  if (!text.trim()) return null;

  // Por frase: «tu pago quedó confirmado» no es una cita (eso lo cuidan los pagos).
  const claim = text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((s) => !/(pago|comprobante|transferencia|deposito|consignacion)/.test(s))
    .map((s) => s.match(BOOKING_CLAIM))
    .find(Boolean);
  if (claim && !input.hasBooking) return { breach: "false_booking", detail: claim[0] };

  const today = text.match(SAME_DAY);
  if (today && !input.bookingToday) return { breach: "same_day_promise", detail: today[0] };

  if (SCHEDULING.test(text) && !EVENT_CONTEXT.test(text)) {
    const allowed = new Set(input.backing.flatMap(timesIn));
    const invented = timesIn(input.text).filter((t) => !allowed.has(t));
    if (invented.length) return { breach: "invented_slots", detail: invented.join(", ") };
  }
  return null;
};

/** Lo que recibe la persona en lugar de la promesa (y el chat pasa a Dayana). */
export const BREACH_HOLDING: Record<PromiseBreach, string> = {
  invented_slots: "Déjame revisar la agenda de Dayana y te comparto por aquí los horarios disponibles.",
  false_booking: "Déjame confirmarlo con Dayana y te escribo por aquí.",
  same_day_promise: "Ya le paso tu mensaje a Dayana; ella revisa su agenda y te confirma por aquí.",
};

/** Por qué no salió, para Dayana («Te toca» y el rastro de la IA). */
export const BREACH_REASON: Record<PromiseBreach, string> = {
  invented_slots: "La IA iba a ofrecer horas que no salieron de tu agenda: no se enviaron. Revisa y ofrécele horas tú.",
  false_booking: "La IA iba a confirmar una cita que no existe: no se envió. Revisa si quieres agendarla.",
  same_day_promise: "La IA iba a prometer que la llamas hoy, sin cita: no se envió. Contéstale tú.",
};
