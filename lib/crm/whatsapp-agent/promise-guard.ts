import { foldForSearch } from "../search-normalize";

/**
 * Lo que la asistente nunca puede prometer sin respaldo (pedido del dueño,
 * 16-oct). Se mira en código, antes de enviar, porque el modelo lo hizo igual
 * con el prompt diciéndole que no:
 *
 * - **Horas inventadas**: a «💙💙💜🩷» le ofreció «sábado 17, 10:00 a. m. o
 *   4:00 p. m.» cuando la agenda no había respondido (no sabía su país). Las
 *   horas de una llamada solo salen de la agenda (o de una cita que ya existe,
 *   o de lo que escribió Dayana), y con el día que la agenda les dio.
 * - **Citas que no existen**: luego le dijo «Sí, queda confirmada para este
 *   sábado» sin haber agendado nada. A Natalia (21-oct) «Tu llamada con Dayana
 *   queda para hoy… 12:45 p. m.» con book_free_call fallido: nadie la llamó.
 * - **«Hoy mismo» / «en un momento»**: a Valentina, «Ya le aviso a Dayana para
 *   que se comunique con ustedes hoy mismo»; a Samy, «Dayana te estará
 *   llamando en unos momentos»; a «la negra bella», «intentamos de nuevo en un
 *   momento». Nadie las llamó.
 *
 * Pura: `run.ts` le da lo que respalda la respuesta (las horas de verdad y si
 * hay una cita) y no envía si hay una falta. La usan también los
 * calificadores de la evaluación. Se mira frase por frase (cada línea de una
 * lista es una frase): una frase sobre el webinar, el curso o un pago no
 * cuenta como oferta de horas, pero si confirma la llamada o la cita, sí.
 */

export type PromiseBreach = "invented_slots" | "false_booking" | "same_day_promise" | "recordings";

/** «10:00 a. m.», «4 p.m.», «8:45 pm», «10 de la mañana» → «10:00a». */
const TIME_AMPM = /\b(\d{1,2})(?::([0-5]\d))?\s*(?:([ap])\.?\s?m\b\.?|de la (manana|tarde|noche))/g;
/** «18:45» (24 h) → «6:45p». */
const TIME_24H = /\b(1[3-9]|2[0-3]):([0-5]\d)\b/g;
/**
 * «a las 15 h», «las 16h» → «3:00p». Solo de la tarde y con «las»: «dura 2 h»,
 * «24h» o «un día de 23 h» no son una hora del día.
 */
const TIME_H = /\blas\s+(1[3-9]|2[0-3])\s?h\b/g;
const HOUR_WORDS = ["una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce"];
const MINUTE_WORDS: Record<string, string> = { media: "30", cuarto: "15", quince: "15", treinta: "30", "cuarenta y cinco": "45" };
/**
 * «a las tres de la tarde», «a la una y media de la tarde» → «3:00p», «1:30p».
 * Solo con «de la mañana/tarde/noche»: «a las dos les escribo» no es una hora.
 */
const TIME_WORDS = new RegExp(
  `\\b(?:la|las)\\s+(${HOUR_WORDS.join("|")})(?:\\s+y\\s+(${Object.keys(MINUTE_WORDS).join("|")}))?\\s+de la (manana|tarde|noche)\\b`,
  "g"
);
/** «a las 10», «a las 4:30» sin a. m./p. m.: la hora sin mañana ni tarde («10:00»). */
const TIME_BARE = /\ba las (\d{1,2})(?::([0-5]\d))?(?![\d:])(?!\s*(?:[ap]\.?\s?m\b|de la\b|hora))/g;

/** Una hora y dónde está en el texto (ya plegado), para saber de qué día es. */
type TimeHit = { time: string; at: number; end: number };

const timeHits = (folded: string): TimeHit[] => {
  const hits: TimeHit[] = [];
  const add = (time: string, m: RegExpMatchArray) => hits.push({ time, at: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  for (const m of folded.matchAll(TIME_AMPM)) {
    const hour = Number(m[1]);
    if (!hour || hour > 12) continue;
    add(`${hour}:${m[2] ?? "00"}${m[3] ?? (m[4] === "manana" ? "a" : "p")}`, m);
  }
  for (const m of folded.matchAll(TIME_24H)) add(`${Number(m[1]) - 12}:${m[2]}p`, m);
  for (const m of folded.matchAll(TIME_H)) add(`${Number(m[1]) - 12}:00p`, m);
  for (const m of folded.matchAll(TIME_WORDS)) {
    add(`${HOUR_WORDS.indexOf(m[1]!) + 1}:${m[2] ? MINUTE_WORDS[m[2]] : "00"}${m[3] === "manana" ? "a" : "p"}`, m);
  }
  const sure = new Set(hits.map((h) => h.time));
  for (const m of folded.matchAll(TIME_BARE)) {
    const hour = Number(m[1]);
    if (!hour || hour > 12) continue;
    const key = `${hour}:${m[2] ?? "00"}`;
    if (!sure.has(`${key}a`) && !sure.has(`${key}p`)) add(key, m);
  }
  return hits;
};

/**
 * Las horas que menciona un texto, normalizadas: «10:00a», «4:00p»; las que no
 * dicen mañana o tarde quedan sin letra («10:00»).
 */
export const timesIn = (text: string): string[] => [...new Set(timeHits(foldForSearch(text)).map((h) => h.time))];

const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const WEEKDAY = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/g;
/** Los días de la semana que nombra un texto («viernes»). */
export const weekdaysIn = (text: string): string[] => [...new Set(foldForSearch(text).match(WEEKDAY) ?? [])];

/**
 * Lo que dice de qué día es una hora: un día de la semana, «hoy» o «mañana»
 * («de la mañana», «en la mañana» es la franja, no el día).
 */
const DAY_REF = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|hoy|(?<!\bla\s)manana)\b/g;
/** «a las 3:00 p. m. del viernes»: el día que va justo después de la hora. */
const DAY_AFTER = /^\s*(?:\(tu hora\)\s*)?(?:del|el|de este|este)\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/;

/**
 * El día de la semana de una hora: el que va justo después («a las 3:00 p. m.
 * del viernes») o el último que se nombró antes en la frase («el jueves 22 a
 * las 3:00 p. m.»). `null` si no hay, o si lo último fue «hoy» o «mañana»: sin
 * la fecha de hoy no se traducen a un día, y esa hora se mira sola.
 */
const dayOf = (s: string, hit: TimeHit): string | null => {
  const after = s.slice(hit.end).match(DAY_AFTER);
  if (after) return after[1]!;
  let day: string | null = null;
  for (const m of s.slice(0, hit.at).matchAll(DAY_REF)) day = m[1]!;
  return day && WEEKDAYS.includes(day) ? day : null;
};

/** ¿Esta hora está respaldada? Una hora sin a. m./p. m. vale si coincide con cualquiera de las dos. */
const backed = (time: string, allowed: Set<string>) =>
  allowed.has(time) || (!/[ap]$/.test(time) && (allowed.has(`${time}a`) || allowed.has(`${time}p`)));

/** «4:45a» → minutos desde la medianoche. */
const minutesOf = (time: string) => {
  const m = time.match(/^(\d{1,2}):(\d\d)([ap])$/);
  return m ? ((Number(m[1]) % 12) + (m[3] === "p" ? 12 : 0)) * 60 + Number(m[2]) : null;
};

/**
 * Lo que respalda: todas sus horas, las que vienen sin día (valen para
 * cualquiera: las de una oferta anterior o de una cita, que run.ts da solo con
 * la hora) y los pares «día hora» de las que traen día («jueves, 22 de
 * octubre, 3:00 p. m.»).
 */
type Agenda = { times: Set<string>; undated: Set<string>; dated: Set<string> };

const agendaOf = (labels: string[]): Agenda => {
  const agenda: Agenda = { times: new Set(), undated: new Set(), dated: new Set() };
  for (const label of labels) {
    const folded = foldForSearch(label);
    const hits = timeHits(folded);
    const days = [...new Set(folded.match(WEEKDAY) ?? [])];
    for (const h of hits) {
      agenda.times.add(h.time);
      if (!days.length) agenda.undated.add(h.time);
      for (const d of days) agenda.dated.add(`${d} ${h.time}`);
    }
    // «viernes, 23 de octubre, 4:45 a. m. (tu hora) · 9:45 p. m. en Colombia»:
    // pasada la medianoche, la hora de Colombia es del día de al lado (el jueves).
    const first = hits[0] && minutesOf(hits[0].time);
    if (days.length !== 1 || first == null) continue;
    const day = WEEKDAYS.indexOf(days[0]!);
    for (const h of hits.slice(1)) {
      const diff = (minutesOf(h.time) ?? first) - first;
      if (diff > 12 * 60) agenda.dated.add(`${WEEKDAYS[(day + 6) % 7]} ${h.time}`);
      if (diff < -12 * 60) agenda.dated.add(`${WEEKDAYS[(day + 1) % 7]} ${h.time}`);
    }
  }
  return agenda;
};

/** ¿Está esa hora, en ese día (si la frase lo dice), en lo que respalda? */
const onAgenda = (agenda: Agenda, time: string, day: string | null) =>
  day ? backed(time, agenda.undated) || backed(`${day} ${time}`, agenda.dated) : backed(time, agenda.times);

/** Habla de agendar o de horas para una llamada o una cita («a las 6:30 p. m. te queda bien»). */
const SCHEDULING = /(llam|cita|agend|horari|disponib|espacio|opcion|reserv|te queda bien|te sirve|que dia)/;
/** Una frase sobre un evento, el curso o un pago: esas horas y esas «confirmaciones» no son de una llamada. */
const NOT_A_CALL = /(webinar|evento|taller|curso|clase|en vivo|\blive\b|grupo|sesion grupal|inscripci|inscrit|cupo|pago|comprobante|transferencia|deposito|consignacion)/;
/** Nombra la llamada o la cita. */
const CALL_WORD = /\b(llamada|cita)\b|\bte\s+(llama|llamara|va\s+a\s+llamar)\b/;
/**
 * Una línea que parece un horario de una lista: con viñeta o empezando por el
 * día, la fecha o la hora («• jueves 23, 5:00 p. m.», «1. viernes 24 de
 * octubre, 4:00 p. m.», «*jueves, 15 de octubre…*», «3:00 p. m.» debajo de «El
 * jueves tengo:»). «Entiendo, el jueves sales a las 5:00 p. m.» no: repite lo
 * que dijo la persona.
 */
const SLOT_LINE =
  /^[\s*_~]*(?:[•·*-]|\d{1,2}[.)]|(?:a\s+las\s+)?\d{1,2}:\d\d\b|(?:el\s+|este\s+)?(?:hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b|\d{1,2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b)/;

const DAY = "(lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|hoy)";
/** «el jueves», «el próximo jueves», «hoy», «las 3» (después de «para»). */
const FOR_DAY = `(el\\s+|este\\s+|esta\\s+)?(proxim[oa]\\s+)?(${DAY}|las\\s+\\d)`;
/**
 * Lo que va antes de un «agende» que no es pasado: «¿quieres que te agende…?»,
 * «para que Dayana te separe…», «cuando agende tu llamada», «no agendé tu
 * llamada» (sin tilde, «agendé» y «agende» se escriben igual).
 */
const NOT_DONE = "(?<!\\b(que|cuando|apenas|cuanto|si|no|ni)\\s+((dayana|ella)\\s+)?((te|le)\\s+)?)";

/**
 * «queda confirmada», «quedó tu llamada el jueves», «ya te agendé», «tu llamada
 * está agendada», «Dayana te llama el sábado». No: «¿quieres que te agende?»,
 * «tu llamada queda para cuando elijas», «Dayana te llama por WhatsApp».
 */
const BOOKING_CLAIM = new RegExp(
  [
    // «quedaste agendada», «quedó programada» (auditoría 21-oct). «Queda anotado» no: así se toma nota de un dato.
    "(queda(s|n|ste|mos)?|quedo|quedaria)\\s+(totalmente\\s+|entonces\\s+)?(confirmad|agendad|reservad|programad|apartad|separad)",
    "(queda|quedo)\\s+(tu|la)\\s+(cita|llamada)\\b",
    "esta(s)?\\s+(confirmad|agendad|reservad|programad)",
    "ya\\s+(te\\s+)?(agende|reserve|confirme)\\b",
    // «te separé el espacio», «te anoté para el jueves» (auditoría 21-oct).
    `${NOT_DONE}\\bte\\s+(agende|reserve|separe|anote)\\s+(para|el|la|tu|un|una)\\b`,
    // «Listo, agendé tu llamada para el jueves», sin «ya» ni «te» (auditoría 21-oct).
    `${NOT_DONE}\\b(agende|reserve|separe|anote)\\s+(tu|la|el|un|una)\\s+(cita|llamada|espacio|horario|hora|turno)\\b`,
    // «te dejé agendada» (auditoría 21-oct).
    "te\\s+(deje|dejo)\\s+(agendad|reservad|confirmad|apartad|separad|programad)",
    // «tu llamada con Dayana queda para hoy», «tu llamada gratis quedó para el viernes»
    // (Natalia, Barbara, Alexandra, Caicedo, 21-oct: el «con Dayana» la dejaba pasar).
    `tu\\s+(cita|llamada)(\\s+gratis|\\s+gratuita|\\s+con\\s+dayana|\\s+de\\s+15\\s+minutos)*\\s+(queda|esta|quedo)\\s+(confirmad|agendad|reservad|para\\s+(${FOR_DAY}|\\d))`,
    // «tu llamada será el jueves», «tu llamada con Dayana es el jueves a las 3» (auditoría 21-oct).
    `(tu|la)\\s+(cita|llamada)(\\s+gratis|\\s+gratuita|\\s+con\\s+dayana|\\s+de\\s+15\\s+minutos)*\\s+(es|sera|va\\s+a\\s+ser)\\s+(el\\s+|este\\s+|esta\\s+)?(proxim[oa]\\s+)?(${DAY}|a\\s+las\\s+\\d)`,
    `(queda|quedo)\\s+para\\s+${FOR_DAY}`,
    // «Ya quedó: jueves 22 de octubre, 3:00 p. m.» (auditoría 21-oct).
    "ya\\s+quedo[\\s:,-]+((hoy|manana)[\\s,]+)?(el\\s+|este\\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\\b",
    `dayana\\s+te\\s+(llama|llamara|va\\s+a\\s+llamar)\\s+(el\\s+${DAY}|este\\s+${DAY}|esta\\s+(tarde|noche)|${DAY}|a\\s+las\\s+\\d)`,
  ].join("|")
);

/** «Dayana te llama…»: con día y hora en la misma frase, es una cita («jueves 23 a las 3:00 p. m., Dayana te llama por WhatsApp»). */
const CALLS_YOU = /\b(dayana|ella)\s+te\s+(llama|llamara|va\s+a\s+llamar)\b/;

/** Cuándo, si es ya: hoy, en un momento, más tarde, esta noche. */
const SOON = "(hoy|hoy mismo|en unos (momentos|minutos)|en breve|en un (momento|ratito|rato)|mas tarde|esta (tarde|noche)|ahorita|enseguida|en seguida)";
/** Que Dayana la llama o la contacta. */
const CONTACT =
  "(se comuni\\w*|se (pondra|pone|va a poner) en contacto|te llam\\w*|les llam\\w*|te va a llamar|te contact\\w*|les contact\\w*|te atiend\\w*|los atiend\\w*|te estar[a-z]* llamando|te escrib\\w*)";

/**
 * «hoy mismo», «Dayana se comunica con ustedes hoy», «te va a llamar en unos
 * minutos», «te contactará en breve», «intentamos de nuevo en un momento».
 */
const SAME_DAY = new RegExp(
  [
    "hoy mismo",
    `${CONTACT}[^.?!\\n]{0,40}\\b${SOON}`,
    `\\b${SOON}[^.?!\\n]{0,30}${CONTACT}`,
    "(intentamos|lo intentamos|volvemos a intentar|te volvemos a llamar) (de nuevo|otra vez|en un momento|mas tarde|ahorita)",
  ].join("|")
);

/**
 * Grabaciones (Fely Mateo, 18-oct: «Las grabaciones de las clases y webinars
 * están en el grupo»). Los eventos gratuitos no se graban y quien no pagó no
 * tiene grabaciones de nada (la dueña): la asistente no afirma que haya una.
 * Decir que NO hay («el webinar no queda grabado») sí puede.
 */
const RECORDING = /\b(grabacion(es)?|grabad[oa]s?|se graba(n|ra|ran)?|lo graba(n|mos|ran)?|queda(ra)? grabad[oa])\b/;
const NEGATED = /\b(no|ni|nunca|tampoco|sin)\b/;

/** Una frase que ofrece o pregunta («¿te sirve…?», «¿cuál prefieres?»), no una que afirma. */
const OFFER = /\?|te (queda|sirve|parece|conviene|funciona)|prefieres|cual (te|de|prefieres)|elige|escoge/;
/** Una condición: «si te sirve el jueves…, Dayana te llama», «cuando elijas». */
const CONDITION = /\bsi\s+(te|quieres|prefieres|eliges|escoges|confirmas|me\s+confirmas|me\s+dices|ese|esa|esta|este)\b|\b(cuando|apenas|en cuanto|una vez)\b|elij|escoj/;

export type PromiseCheck = {
  /** Lo que recibiría la persona. */
  text: string;
  /**
   * Lo que respalda las horas: las etiquetas que devolvió la agenda (en esta
   * vuelta o hace poco), las horas de sus citas y lo que escribió Dayana.
   */
  backing: string[];
  /** Hay una cita de verdad: agendada en esta vuelta o activa en el calendario. */
  hasBooking: boolean;
  /**
   * El día y la hora de esas citas («viernes 9:00 a. m.», en cada zona). Con
   * cita, lo que se confirma tiene que ser eso: a Alexandra (21-oct) le
   * confirmaron el viernes cuando la que tenía era el jueves.
   */
  bookedLabels?: string[];
  /** Esa cita es hoy. */
  bookingToday: boolean;
};

export type PromiseVerdict = { breach: PromiseBreach; detail: string } | null;

const sentencesOf = (folded: string) =>
  folded
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** La confirmación de una frase (`BOOKING_CLAIM`, o día + hora + «Dayana te llama» sin «si…» ni pregunta). */
const claimIn = (s: string): { text: string; at: number } | null => {
  const claim = s.match(BOOKING_CLAIM);
  if (claim) return { text: claim[0], at: claim.index ?? 0 };
  if (s.search(DAY_REF) < 0 || !timeHits(s).length || OFFER.test(s) || CONDITION.test(s)) return null;
  const calls = s.match(CALLS_YOU);
  // Toda la frase es la confirmación: el día y la hora pueden ir antes.
  return calls ? { text: calls[0], at: 0 } : null;
};

/**
 * La confirmación de la llamada en una frase. En una que habla de un pago, un
 * cupo o un evento solo cuenta la que va en un trozo (entre comas, «;» o «y»)
 * que nombra la llamada o la cita (auditoría 21-oct: «Tu llamada queda para el
 * viernes a las 3:00 p. m.; ahí Dayana te cuenta lo del pago» salía entera
 * porque nombraba el pago). «Tu pago quedó confirmado» no es una cita.
 */
const callClaimIn = (s: string) => {
  if (!NOT_A_CALL.test(s)) return claimIn(s);
  for (const part of s.split(/[;,]|\s(?:y|pero)\s/)) {
    const claim = CALL_WORD.test(part) ? claimIn(part) : null;
    if (claim) return { text: claim.text, at: s.indexOf(part) + claim.at };
  }
  return null;
};

/**
 * La confirmación va dentro de una pregunta («¿Te parece si Dayana te llama
 * hoy a las 4:00 p. m.?»): es una oferta. Si va antes («Tu llamada queda para
 * el jueves 3:00 p. m., ¿te parece?»), es una confirmación con pregunta al
 * final (auditoría 21-oct: salía).
 */
const asked = (s: string, at: number) => {
  const open = s.lastIndexOf("¿", at);
  if (open >= 0) return !s.slice(open, at).includes("?");
  return !s.includes("¿") && s.endsWith("?") && OFFER.test(s.slice(0, at));
};

/** ¿La respuesta promete algo que nada respalda? `null` si está bien. */
export const promiseBreach = (input: PromiseCheck): PromiseVerdict => {
  // «6:30 p. m.» → «6:30 pm»: si no, el punto de «p.» corta la frase y la hora se pierde.
  const folded = foldForSearch(input.text).replace(/\b([ap])\.\s?m\b\.?/g, "$1m");
  if (!folded.trim()) return null;
  const all = sentencesOf(folded);
  const sentences = all.filter((s) => !NOT_A_CALL.test(s));

  const recorded = all.find((s) => RECORDING.test(s) && !NEGATED.test(s));
  if (recorded) return { breach: "recordings", detail: recorded.match(RECORDING)![0] };

  const agenda = agendaOf(input.backing);
  /** Todas sus horas, cada una con su día, salieron de lo que respalda. */
  const allBacked = (s: string) => {
    const hits = timeHits(s);
    return hits.length > 0 && hits.every((h) => onAgenda(agenda, h.time, dayOf(s, h)));
  };
  /** Pregunta con horas que dio la agenda: ofrece, no afirma. */
  const backedQuestion = (s: string) => allBacked(s) && OFFER.test(s);
  const booked = agendaOf(input.bookedLabels ?? []);
  const bookedDays = new Set((input.bookedLabels ?? []).flatMap(weekdaysIn));
  for (const s of all) {
    const claim = callClaimIn(s);
    // «¿Te parece si Dayana te llama hoy a las 4:00 p. m.?» con esa hora de la agenda: es una oferta.
    if (!claim || (asked(s, claim.at) && allBacked(s))) continue;
    if (!input.hasBooking) return { breach: "false_booking", detail: claim.text };
    // Hay cita, pero lo que confirma es otro día u otra hora (el día y la hora
    // juntos: con citas el jueves 12:30 y el viernes 9:00, «el viernes a las
    // 12:30» no es ninguna). Se mira desde la confirmación: «ya no es el
    // jueves: tu llamada queda para el viernes…» vale.
    if (input.bookedLabels?.length) {
      const claimed = s.slice(claim.at);
      const otherTime = timeHits(claimed).some((h) => !onAgenda(booked, h.time, dayOf(claimed, h)));
      const otherDay = weekdaysIn(claimed).some((d) => !bookedDays.has(d));
      if (otherTime || otherDay) return { breach: "false_booking", detail: claim.text };
    }
  }
  if (!input.bookingToday) {
    for (const [i, s] of sentences.entries()) {
      const soon = s.match(SAME_DAY);
      if (!soon) continue;
      // Ofrecer una hora de hoy que dio la agenda («¿te sirve que Dayana te
      // llame hoy a las 4:00 p. m.?») no es prometer: hoy y mañana van primero
      // (pedido de la dueña, 17-oct). La pregunta puede ir en la frase
      // siguiente: «hoy mismo hay 4:30 p. m. y 5:00 p. m. ¿Te sirve alguna?»
      // (Danilo, 18-oct: no salió y se quedó sin horas).
      if (backedQuestion(s) || (allBacked(s) && sentences.slice(i + 1).some((next) => OFFER.test(next)))) continue;
      return { breach: "same_day_promise", detail: soon[0] };
    }
  }
  // De qué habla cada frase: de la llamada, de otra cosa (un evento, un pago) o
  // de nada en particular. Una línea de una lista («• jueves 23, 5:00 p. m.»)
  // no dice «llamada»: toma el tema de la frase que la presenta (la de antes o,
  // si no hay, la de después). Así las horas inventadas en viñetas ya no salen
  // (auditoría 21-oct) y las fechas del webinar en lista siguen saliendo.
  const topics = all.map((s) => (NOT_A_CALL.test(s) ? "other" : SCHEDULING.test(s) || claimIn(s) ? "call" : null));
  const topicOf = (i: number) => topics.slice(0, i + 1).findLast(Boolean) ?? topics.slice(i + 1).find(Boolean) ?? null;
  const invented = all
    .filter((s, i) => topics[i] === "call" || (!topics[i] && SLOT_LINE.test(s) && topicOf(i) === "call"))
    .flatMap((s) =>
      timeHits(s).flatMap((h) => {
        const day = dayOf(s, h);
        return onAgenda(agenda, h.time, day) ? [] : [day ? `${day} ${h.time}` : h.time];
      })
    );
  if (invented.length) return { breach: "invented_slots", detail: [...new Set(invented)].join(", ") };
  return null;
};

/** ¿La respuesta le confirma una llamada o una cita (exista o no)? */
export const confirmsCall = (text: string): boolean =>
  promiseBreach({ text, backing: [], hasBooking: false, bookingToday: true })?.breach === "false_booking";

/** Lo que recibe la persona en lugar de la promesa (y el chat pasa a Dayana). */
export const BREACH_HOLDING: Record<PromiseBreach, string> = {
  invented_slots: "Déjame revisar la agenda de Dayana y te comparto por aquí los horarios disponibles.",
  false_booking: "Déjame confirmarlo con Dayana y te escribo por aquí.",
  same_day_promise: "Ya le paso tu mensaje a Dayana; ella revisa su agenda y te confirma por aquí.",
  recordings: "Déjame confirmarlo con Dayana y te escribo por aquí.",
};

/** Por qué no salió, para Dayana («Te toca» y el rastro de la IA). */
export const BREACH_REASON: Record<PromiseBreach, string> = {
  invented_slots: "La IA iba a ofrecer horas que no salieron de tu agenda: no se enviaron. Revisa y ofrécele horas tú.",
  false_booking: "La IA iba a confirmar una cita que no existe: no se envió. Revisa si quieres agendarla.",
  same_day_promise: "La IA iba a prometer que la llamas hoy o en un momento, sin cita: no se envió. Contéstale tú.",
  recordings: "La IA iba a hablar de grabaciones (los eventos gratuitos no se graban): no se envió. Contéstale tú.",
};
