import { getDateKeyInTz, zonedDateTimeToUtc } from "@/lib/datetime/zoned-time";

import { foldForSearch } from "../search-normalize";
import { isAutoSend } from "../whatsapp-attention-rules";
import { timesIn, weekdaysIn } from "./promise-guard";
import { isDayanaOwn } from "./reply-guards";
import { claimMatches, namesWhen } from "./slot-choice";

/**
 * La hora que la asistente le propuso sola y la persona aceptó (Xime, 22-oct,
 * en reglas puras). 20 min antes de su llamada pidió reagendar; el modelo, sin
 * `offer_free_call_slots`, le escribió «Mañana viernes a las 8:00 a. m. de tu
 * hora (9:00 a. m. de Colombia), ¿te queda bien?» (una hora de una lista vieja
 * que ya había tomado otra persona) y ella contestó «si mañana esta perfecto a
 * esa hora». Esa hora no estaba en ninguna lista numerada, así que el código no
 * la veía: su «sí» se quedó sin respuesta y nadie la agendó.
 *
 * Aquí solo se lee QUÉ hora se acordó. Si de verdad está libre lo decide la
 * agenda (`freeCallSlotsAround`): una hora que escribió el modelo nunca se
 * agenda sin estar entre las horas libres de Dayana.
 */

export type AgreedLine = {
  direction: string;
  body?: string | null;
  sentAt: Date;
  kind?: string | null;
  status?: string | null;
  attachments?: unknown;
  isAutoReply?: boolean | null;
  source?: string | null;
  clientKey?: string | null;
};

/** Su «sí» tiene que llegar antes de esto desde la propuesta (y, para reagendar, desde ahora). */
export const AGREED_MAX_AGE_MS = 12 * 3600_000;
const MAX_BURST = 3;
const MAX_YES_CHARS = 160;

/** Lo que escribió la asistente (la IA o una propuesta suya que Dayana aprobó), no un recordatorio ni un masivo. */
const isAssistant = (m: AgreedLine): boolean =>
  m.direction === "OUTBOUND" && ((Boolean(m.isAutoReply) && !isAutoSend(m)) || m.source === "approval");

const hasAttachments = (m: AgreedLine) => Array.isArray(m.attachments) && m.attachments.length > 0;

/**
 * Lo último que escribió la persona (sus mensajes seguidos, del más viejo al
 * más nuevo) y el mensaje de la asistente justo antes. Lo de Dayana sin horas
 * entre medio (un audio, «no hay problema, quedamos atentos para reagendar») no
 * corta: el «sí» sigue siendo a la hora de la asistente. Cualquier otra cosa
 * (un recordatorio, horas de Dayana) sí corta: entonces `ask` es null.
 */
export const burstAndAsk = (messagesNewestFirst: AgreedLine[]): { burst: AgreedLine[]; ask: AgreedLine | null } => {
  const lines = messagesNewestFirst.filter((m) => m.kind !== "system" && m.status !== "FAILED");
  let i = 0;
  while (i < lines.length && lines[i].direction === "INBOUND") i++;
  const burst = lines.slice(0, i).reverse();
  let j = i;
  while (j < lines.length && isDayanaOwn({ ...lines[j], isAutoReply: Boolean(lines[j].isAutoReply) }) && timesIn(lines[j].body ?? "").length === 0) j++;
  const ask = lines[j] && isAssistant(lines[j]) ? lines[j] : null;
  return { burst, ask };
};

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const DAY_OF_MONTH = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MONTHS.join("|")})\\b`, "g");
/** «mañana» el día, no «de la mañana» / «en la mañana» / «por la mañana». */
const TOMORROW = /(?<!\b(?:la|pasado|esta)\s)\bmanana\b/;
const BULLET = /^\s*(?:[•\-*]|\d+[.)])\s+/;
const SENTENCE_END = /(?<=[.!?])(?<!\b[ap]\.)(?<!\b[ap]\.\s?m\.)\s+/;

const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekdayOfKey = (key: string) => new Date(`${key}T12:00:00Z`).getUTCDay();
const validKey = (y: number, m: number, d: number): string | null => {
  const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return new Date(`${key}T12:00:00Z`).toISOString().slice(0, 10) === key ? key : null;
};

/** El único día que nombra el texto, visto desde `sentAt` en la zona `tz` («YYYY-MM-DD»). Varios días o ninguno: null. */
const dayKeyIn = (folded: string, sentAt: Date, tz: string): string | null => {
  const base = getDateKeyInTz(sentAt, tz);
  const keys = new Set<string>();
  if (/\bhoy\b/.test(folded)) keys.add(base);
  if (/\bpasado manana\b/.test(folded)) keys.add(addDays(base, 2));
  else if (TOMORROW.test(folded)) keys.add(addDays(base, 1));
  const year = Number(base.slice(0, 4));
  for (const m of folded.matchAll(DAY_OF_MONTH)) {
    const day = Number(m[1]);
    const month = MONTHS.indexOf(m[2]) + 1;
    const key = validKey(year, month, day);
    const k = key && key >= base ? key : validKey(year + 1, month, day);
    if (!k) return null;
    keys.add(k);
  }
  const weekdays = weekdaysIn(folded).map((wd) => WEEKDAYS.indexOf(wd));
  // Con la fecha (o «mañana»), el día de la semana solo tiene que cuadrar; sin ella, el próximo.
  if (keys.size === 0) {
    for (const target of weekdays) {
      for (let n = 0; n < 7; n++) {
        const k = addDays(base, n);
        if (weekdayOfKey(k) === target) {
          keys.add(k);
          break;
        }
      }
    }
  } else if (weekdays.some((w) => [...keys].some((k) => weekdayOfKey(k) !== w))) return null;
  return keys.size === 1 ? [...keys][0] : null;
};

const to24 = (t: string): string | null => {
  const m = /^(\d{1,2}):(\d\d)([ap])$/.exec(t);
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (m[3] === "p" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${m[2]}`;
};

/**
 * La hora que propone un mensaje de la asistente, si propone UNA: una
 * pregunta sobre esa hora («… a las 8:00 a. m. de tu hora (9:00 a. m. de
 * Colombia), ¿te queda bien?»), un solo día (hoy, mañana, un día de la semana o
 * una fecha, que no se contradigan) y una o dos horas con a. m./p. m. que sean
 * el mismo instante en su zona y en la de Colombia. El día es el suyo (se le
 * escribe a ella: «mañana» es su mañana; la hora de Colombia puede caer el día
 * de al lado). Una lista, horas sin a. m./p. m. o dos zonas posibles sin decir
 * cuál: null (no se adivina).
 */
export const proposedStart = (text: string, sentAt: Date, zones: { personTz: string; dayanaTz: string }): string | null => {
  if (!/[?¿]/.test(text)) return null;
  const lines = text.split("\n");
  if (lines.some((l) => BULLET.test(l) && timesIn(l).length > 0)) return null;
  const sentences = lines.flatMap((l) => l.split(SENTENCE_END)).map((s) => s.trim()).filter(Boolean);
  const asksAboutIt = sentences.some(
    (s, i) => timesIn(s).length > 0 && (/[?¿]/.test(s) || (Boolean(sentences[i + 1]) && /\?/.test(sentences[i + 1]) && sentences[i + 1].length <= 60))
  );
  if (!asksAboutIt) return null;
  const folded = foldForSearch(text).replace(/\s+/g, " ");
  const hms = timesIn(folded).map(to24);
  if (hms.length === 0 || hms.length > 2 || hms.some((h) => !h)) return null;
  const key = dayKeyIn(folded, sentAt, zones.personTz);
  if (!key) return null;
  const at = (k: string, hm: string, tz: string) => zonedDateTimeToUtc(k, hm, tz).getTime();
  const sameZone = zones.personTz === zones.dayanaTz;
  if (hms.length === 1) {
    if (sameZone) return new Date(at(key, hms[0]!, zones.personTz)).toISOString();
    // Una sola hora y dos zonas distintas: solo si dice de cuál es.
    const saysColombia = /\bcolombia\b/.test(folded);
    const saysHers = /\b(tu|su) hora\b/.test(folded);
    if (saysColombia === saysHers) return null;
    return new Date(at(key, hms[0]!, saysColombia ? zones.dayanaTz : zones.personTz)).toISOString();
  }
  // Dos horas: la misma, una en su zona y otra en la de Colombia («8:00 a. m. de tu hora (9:00 a. m. de Colombia)»).
  if (sameZone) return null;
  const [a, b] = hms as string[];
  const found = new Set<number>();
  for (const [mine, theirs] of [
    [a, b],
    [b, a],
  ]) {
    const p = at(key, mine, zones.personTz);
    if ([-1, 0, 1].some((n) => at(addDays(key, n), theirs, zones.dayanaTz) === p)) found.add(p);
  }
  return found.size === 1 ? new Date([...found][0]).toISOString() : null;
};

/** Un «sí» de verdad a esa hora. */
const YES =
  /\b(si+|sip|claro|ok+|okey|okay|oki|vale|dale|listo|perfect[oa]|de acuerdo|excelente|genial|super|bueno|esta bien|queda bien|me sirve|me parece|me viene|confirmo|confirmado|agendame|agendala|por favor|porfa|porfavor|me encanta|de una|asi es|correcto|exacto)\b/;
/**
 * Lo que no es aceptarla: una pregunta, un «no», otra hora u otro día, un
 * «pero», lo que tiene que hacer, «te confirmo / déjame ver» (todavía no dijo que sí).
 */
const NOT_YES =
  /[?¿]|\b(no|nop|ninguna|ninguno|otra|otro|otras|otros|cambiar|cambio|tampoco|pero|aunque|mejor|imposible|dificil|complicad[oa]|cuanto|cuesta|precio|tengo|trabajo|ocupad[oa]s?|cita|clase|reunion|despues|luego|a ver|lo pienso|lo pensare)\b|\b(te|le|les) (confirmo|aviso|digo|escribo)\b|\bdejame (ver|revisar|pensar|confirmar)\b|\bvoy a ver\b/;

/** ¿Lo que escribió acepta la hora que le propusieron? Corto, con un sí y sin peros. */
export const saysYesToTime = (text: string): boolean => {
  const t = foldForSearch(text).replace(/\s+/g, " ").trim();
  return Boolean(t) && t.length <= MAX_YES_CHARS && YES.test(t) && !NOT_YES.test(t);
};

export type AgreedProposal = {
  startIso: string;
  /** Lo que escribió ella (sus mensajes seguidos). */
  said: string;
  saidAt: Date;
  proposedAt: Date;
};

/**
 * ¿La persona acaba de aceptar la hora que le propuso la asistente? Lo último
 * del chat son sus mensajes (a lo sumo tres, sin fotos); justo antes (sin
 * contar lo de Dayana sin horas) la propuesta de una sola hora; su respuesta
 * dice que sí, y si nombra un día o una hora, es esa. Mensajes del más nuevo al
 * más viejo. `maxAgeMs`: su «sí» no puede ser más viejo que eso (al reagendar).
 */
export const agreedProposal = (
  messagesNewestFirst: AgreedLine[],
  ctx: { personTz: string; dayanaTz: string; now?: Date; maxAgeMs?: number }
): AgreedProposal | null => {
  const { burst, ask } = burstAndAsk(messagesNewestFirst);
  if (!ask || !burst.length || burst.length > MAX_BURST || burst.some(hasAttachments)) return null;
  const saidAt = burst[0].sentAt;
  const lastAt = burst[burst.length - 1].sentAt;
  if (saidAt.getTime() - ask.sentAt.getTime() > AGREED_MAX_AGE_MS) return null;
  if (ctx.now && ctx.maxAgeMs !== undefined && ctx.now.getTime() - lastAt.getTime() > ctx.maxAgeMs) return null;
  const said = burst
    .map((m) => (m.body ?? "").trim())
    .filter(Boolean)
    .join(" ");
  if (!said || !saysYesToTime(said)) return null;
  const startIso = proposedStart(ask.body ?? "", ask.sentAt, ctx);
  if (!startIso) return null;
  // «mañana a esa hora»: lo que nombre tiene que ser esa misma hora (leído desde cuando lo escribió).
  if (namesWhen(said) && !claimMatches(said, { startIso, label: "" }, { personTz: ctx.personTz, dayanaTz: ctx.dayanaTz, now: saidAt })) return null;
  return { startIso, said, saidAt, proposedAt: ask.sentAt };
};

/** ¿El mensaje de la asistente justo antes de lo que escribió le ofrecía horas (una lista o una hora, con pregunta)? */
export const offeredHoursBefore = (messagesNewestFirst: AgreedLine[], now: Date): boolean => {
  const { burst, ask } = burstAndAsk(messagesNewestFirst);
  if (!ask || !burst.length) return false;
  if (now.getTime() - ask.sentAt.getTime() > AGREED_MAX_AGE_MS) return false;
  const body = ask.body ?? "";
  return timesIn(body).length > 0 && /[?¿]/.test(body);
};
