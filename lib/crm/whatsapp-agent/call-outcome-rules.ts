import { isAutoSend } from "../whatsapp-attention-rules";
import { foldForSearch } from "../search-normalize";
import { personFirstName } from "@/lib/person-name";
import { getDateKeyInTz, getTimeLabelInTz } from "@/lib/datetime/zoned-time";

/**
 * ¿La llamada gratis se hizo? WhatsApp no avisa de las llamadas que Dayana
 * hace desde su celular (coexistencia), así que se deduce del chat, en reglas
 * puras:
 *
 * - Señales de que NO se hizo: la persona escribe «no me llamaron», «sigo
 *   esperando», «se me pasó», «no pude contestar», «¿a qué hora me llaman?»;
 *   o Dayana escribe «te llamé y no contestaste», «intenté llamarte».
 * - Señales de que SÍ se hizo: «gracias por la llamada», «fue un gusto», «ya
 *   hablé con Dayana»; o Dayana escribe «fue un gusto hablar contigo», manda
 *   los paquetes, un enlace de pago o «bienvenida».
 * - Si no hay señales claras (o hay de las dos), se le pregunta a la persona
 *   (`checkReply` lee su respuesta), solo por llamadas recientes
 *   (`followUpStep`).
 * - Dayana, que ve «Sin respuesta» en su celular, lo marca con un toque en el
 *   chat o en Agenda (`planManualMark`).
 */

export type CallOutcome = "answered" | "no_answer";

export type OutcomeMessage = {
  direction: "INBOUND" | "OUTBOUND";
  body: string | null;
  sentAt: Date;
  isAutoReply?: boolean;
  source?: string | null;
  clientKey?: string | null;
};

const PERSON_NO = [
  /\bno me (llamaron|llamo|llamaste|llego la llamada|entro la llamada|timbro)\b/,
  /\bno (recibi|vi|escuche|me entro) (la|ninguna) llamada\b/,
  /\b(sigo|estaba|estoy|me quede) esperando\b/,
  /\bse me (paso|olvido)\b/,
  /\bno (pude|alcance a) (contestar|atender|responder)\b/,
  /\b(a que hora|cuando) me (llama|llaman|va a llamar|vas a llamar)\b/,
  /\bme (van|vas) a llamar\b/,
  /\bno me pude conectar\b/,
];

const PERSON_YES = [
  /\bgracias por (la llamada|tu tiempo|su tiempo|atenderme|escucharme|el espacio)\b/,
  /\bfue un (gusto|placer)\b/,
  /\bya (hable|hablamos) con (ella|dayana|usted)\b/,
  /\bme (encanto|gusto) (la llamada|hablar|la charla|conocerte)\b/,
  /\b(estuvo|fue) (muy )?(bonita|linda|buena|genial) la (llamada|charla)\b/,
];

const DAYANA_NO = [
  /\bte (llame|marque|estoy llamando|acabo de llamar)\b.*\bno (contestas|contestaste|respondes)\b/,
  /\bno (contestas|contestaste|respondes|respondiste)\b/,
  /\bintente (llamarte|comunicarme)\b/,
  /\bno (pude|logre) comunicarme\b/,
  /\bno logramos comunicarnos\b/,
];

const DAYANA_YES = [
  /\bfue un (gusto|placer) (hablar|conocerte|conversar)\b/,
  /\bgracias por (tu tiempo|la llamada|el espacio|abrirte)\b/,
  /\bcomo (te|lo) (comente|hablamos|conversamos)\b/,
  /\bte (comparto|envio|mando) (los |las )?(paquetes|opciones|informacion|valores)\b/,
  /\/pagar\//,
  /\bbienvenid[ao]\b/,
];

const match = (res: RegExp[], text: string) => res.some((re) => re.test(text));

/**
 * Lo que dice el chat desde que empezó la llamada. `null` si no hay nada
 * claro (o hay señales de las dos): entonces se pregunta.
 */
export const outcomeFromChat = (
  messages: OutcomeMessage[],
  opts: { startsAt: Date; paidAfter?: boolean }
): { outcome: CallOutcome; reason: string } | null => {
  if (opts.paidAfter) return { outcome: "answered", reason: "Pagó después de la llamada." };
  let yes: string | null = null;
  let no: string | null = null;
  for (const m of messages) {
    if (m.sentAt.getTime() < opts.startsAt.getTime() - 15 * 60_000) continue;
    const text = foldForSearch(m.body ?? "");
    if (!text) continue;
    if (m.direction === "INBOUND") {
      if (!no && match(PERSON_NO, text)) no = "Ella escribió que no recibió la llamada o no pudo contestar.";
      if (!yes && match(PERSON_YES, text)) yes = "Ella agradeció la llamada.";
    } else {
      // Lo que salió solo (la IA, recordatorios, masivos) no dice si Dayana llamó.
      if (m.isAutoReply || isAutoSend(m)) continue;
      if (!no && match(DAYANA_NO, text)) no = "Dayana escribió que no le contestó.";
      if (!yes && match(DAYANA_YES, text)) yes = "Dayana escribió después de hablar con ella.";
    }
  }
  if (yes && !no) return { outcome: "answered", reason: yes };
  if (no && !yes) return { outcome: "no_answer", reason: no };
  return null;
};

/** La respuesta a «¿Pudiste hablar con Dayana?». `null` si no se entiende. */
export const checkReply = (text: string): CallOutcome | null => {
  const t = foldForSearch(text).replace(/[!¡.?¿,]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (match(PERSON_NO, t) || /^(no|nop|nope|no senor|no senora|todavia no|aun no|nada)\b/.test(t)) return "no_answer";
  if (match(PERSON_YES, t) || /^(si|sii+|claro|ya|asi es|si pude|si hablamos|si gracias|perfecto|excelente|todo bien|muy bien)\b/.test(t)) {
    return "answered";
  }
  return null;
};

/**
 * El mensaje para reagendar, con las horas (o sin ellas si no hay libres). Voz
 * de la asistente (Dayana en tercera persona), sin apodos ni corazones y sin
 * suponer el género de nadie: «no lograron comunicarse», nunca «quedamos
 * atentos». Las horas vienen con a. m./p. m. (`dualZoneLabel`).
 */
export const rescheduleMessage = (name: string | null | undefined, slotLabels: string[]): string => {
  const first = personFirstName(name);
  const hi = first ? `Hola ${first}` : "Hola";
  const head = `${hi} 🙏 Dayana te llamó a la hora de tu llamada gratis y no lograron comunicarse. Con gusto la reagendamos.`;
  if (slotLabels.length === 0) return `${head} Escríbeme qué día y hora te quedan bien y te la agendo de nuevo.`;
  return `${head} Estos son los espacios libres de Dayana:\n${slotLabels.map((l) => `• ${l}`).join("\n")}\n¿Cuál te queda mejor?`;
};

/** La pregunta cuando el chat no dice nada claro. */
export const checkMessage = (name: string | null | undefined): string => {
  const first = personFirstName(name);
  return `${first ? `Hola ${first}` : "Hola"} 🙏 ¿Pudiste hablar con Dayana en tu llamada gratis?`;
};

// ── Qué hace el reloj con cada llamada (y la primera vez que corre) ─────────

const HOUR = 3600_000;

/**
 * «¿Pudiste hablar con Dayana?» solo sale si la llamada terminó hace menos de
 * esto. Existe por la primera vez que el reloj corre en producción: ese día ve
 * todas las llamadas gratis de la última semana sin resultado, y preguntarle a
 * alguien por una llamada de hace cuatro días sería raro (y molesto). Las más
 * viejas quedan sin decidir para Dayana (botones en el chat y en Agenda),
 * salvo que el chat lo diga claro.
 */
export const CHECK_MAX_AGE_HOURS = 6;

/**
 * El mensaje para reagendar, cuando lo decide el CHAT («no me llamaron»), solo
 * si la llamada terminó hace menos de esto: más tarde ya no viene a cuento (y
 * casi siempre haría falta la plantilla). Lo que decide el tiempo sin respuesta
 * a la pregunta sí lo manda: ahí se le preguntó a tiempo.
 */
export const RESCHEDULE_FROM_CHAT_MAX_AGE_HOURS = 24;

/** Las llamadas que se siguen (el reloj, el chat y Agenda): las que terminaron en los últimos 7 días. */
export const FOLLOW_UP_LOOKBACK_DAYS = 7;

/** Dayana puede marcar cómo terminó desde 5 min después de la hora (antes, la llamada sigue). */
export const MARK_AFTER_START_MIN = 5;

export type FollowUpStep =
  /** Queda decidida; `reschedule`: se le manda el mensaje para reagendar. */
  | { kind: "settle"; outcome: CallOutcome; source: "chat" | "timeout"; reason: string; reschedule: boolean }
  /** Se le pregunta «¿Pudiste hablar con Dayana?». */
  | { kind: "ask" }
  /** Ya se le preguntó: se espera su respuesta. */
  | { kind: "wait" }
  /** El chat está en silencio para la asistente (no se escribe nada). */
  | { kind: "silenced" }
  /** Muy vieja para preguntar: queda para que Dayana la marque. */
  | { kind: "too_old" };

/**
 * Lo que el reloj hace con una llamada gratis que ya terminó y aún no tiene
 * resultado. Pura: la usan `sweepCallOutcomes` y las pruebas.
 *
 * - El chat lo dice claro → decidida (en silencio también). Si fue «no
 *   contestó» y terminó hace menos de {@link RESCHEDULE_FROM_CHAT_MAX_AGE_HOURS} h,
 *   se le mandan horas.
 * - Sin señales: se pregunta solo si terminó hace menos de
 *   {@link CHECK_MAX_AGE_HOURS} h; si ya se preguntó y pasaron
 *   `assumeMissedAfterHours` sin respuesta, no contestó (y se le mandan horas).
 */
export const followUpStep = (input: {
  endsAt: Date;
  now: Date;
  fromChat: { outcome: CallOutcome; reason: string } | null;
  /** Cuándo se le preguntó (null = nunca). */
  checkSentAt: Date | null;
  /** Silencio del chat o IA apagada: solo se decide, no se escribe. */
  blocked: boolean;
  assumeMissedAfterHours: number;
}): FollowUpStep => {
  const age = input.now.getTime() - input.endsAt.getTime();
  if (input.fromChat) {
    return {
      kind: "settle",
      outcome: input.fromChat.outcome,
      source: "chat",
      reason: input.fromChat.reason,
      reschedule: input.fromChat.outcome === "no_answer" && !input.blocked && age < RESCHEDULE_FROM_CHAT_MAX_AGE_HOURS * HOUR,
    };
  }
  if (input.blocked) return { kind: "silenced" };
  if (!input.checkSentAt) return age < CHECK_MAX_AGE_HOURS * HOUR ? { kind: "ask" } : { kind: "too_old" };
  if (input.now.getTime() - input.checkSentAt.getTime() >= input.assumeMissedAfterHours * HOUR) {
    return { kind: "settle", outcome: "no_answer", source: "timeout", reason: `Sin respuesta en ${input.assumeMissedAfterHours} h.`, reschedule: true };
  }
  return { kind: "wait" };
};

// ── Dayana lo marca con un toque ────────────────────────────────────────────

/**
 * ¿Le falta a esta cita que Dayana diga cómo terminó? Activa, sin resultado,
 * empezó hace {@link MARK_AFTER_START_MIN} min o más y terminó en los últimos
 * {@link FOLLOW_UP_LOOKBACK_DAYS} días. (Que sea la llamada gratis lo decide
 * `isFreeCallAppointment`, con el servicio de la reserva.)
 */
export const needsOutcomeMark = (a: { status: string; callOutcome: string | null; startsAt: Date; endsAt: Date }, now: Date): boolean =>
  a.status === "active" &&
  a.callOutcome === null &&
  a.startsAt.getTime() <= now.getTime() - MARK_AFTER_START_MIN * 60_000 &&
  a.endsAt.getTime() >= now.getTime() - FOLLOW_UP_LOOKBACK_DAYS * 24 * HOUR;

export type ManualMarkPlan =
  | { kind: "already_decided" }
  | { kind: "not_yet" }
  /** `send`: qué mensaje sale (solo «no contestó» manda horas, salvo chat en silencio). */
  | { kind: "settle"; outcome: CallOutcome; reason: string; send: "reschedule" | "none" | "silenced" };

/**
 * Dayana marca en el CRM cómo terminó («Hablaron» / «No contestó»). Solo una
 * llamada sin resultado (lo que ya decidió el chat, la respuesta o el tiempo
 * no se cambia desde aquí) y que ya empezó.
 */
export const planManualMark = (input: {
  callOutcome: string | null;
  startsAt: Date;
  now: Date;
  outcome: CallOutcome;
  blocked: boolean;
}): ManualMarkPlan => {
  if (input.callOutcome !== null) return { kind: "already_decided" };
  if (input.startsAt.getTime() > input.now.getTime()) return { kind: "not_yet" };
  if (input.outcome === "answered") return { kind: "settle", outcome: "answered", reason: "Dayana marcó en el CRM que hablaron.", send: "none" };
  return { kind: "settle", outcome: "no_answer", reason: "Dayana marcó en el CRM que no contestó.", send: input.blocked ? "silenced" : "reschedule" };
};

export type RescheduleSend = { sent: true } | { sent: false; reason: "needs_template" | "failed" };

/** Qué pasó con el mensaje para reagendar, en lo que la pantalla sabe explicar. */
export const rescheduleSendOf = (r: { status: string; reason?: string }): RescheduleSend =>
  r.status === "sent"
    ? { sent: true }
    : r.status === "skipped" && r.reason === "needs_template"
      ? { sent: false, reason: "needs_template" }
      : { sent: false, reason: "failed" };

/**
 * «de hoy, 7:15 p. m.», «de ayer, 7:15 p. m.», «del lunes 13 de octubre,
 * 7:15 p. m.»: cuándo fue la llamada, en la zona de Dayana, para la pregunta
 * «¿Cómo terminó la llamada gratis …?».
 */
export const callWhenLabel = (startsAt: Date, now: Date, timeZone: string): string => {
  const day = getDateKeyInTz(startsAt, timeZone);
  const today = getDateKeyInTz(now, timeZone);
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  const time = getTimeLabelInTz(startsAt, timeZone);
  if (day === today) return `de hoy, ${time}`;
  if (day === y.toISOString().slice(0, 10)) return `de ayer, ${time}`;
  // «jueves, 15 de octubre» → «jueves 15 de octubre» (ya va una coma antes de la hora).
  const date = new Intl.DateTimeFormat("es-CO", { timeZone, weekday: "long", day: "numeric", month: "long" })
    .format(startsAt)
    .replace(/^(\p{L}+),\s+/u, "$1 ");
  return `del ${date}, ${time}`;
};
