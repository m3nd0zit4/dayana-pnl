import { foldForSearch } from "../search-normalize";

/**
 * Lo que la asistente nunca puede prometer sin respaldo (pedido del dueño,
 * 16-oct). Se mira en código, antes de enviar, porque el modelo lo hizo igual
 * con el prompt diciéndole que no:
 *
 * - **Horas inventadas**: a «💙💙💜🩷» le ofreció «sábado 17, 10:00 a. m. o
 *   4:00 p. m.» cuando la agenda no había respondido (no sabía su país). Las
 *   horas de una llamada solo salen de la agenda (o de una cita que ya existe,
 *   o de lo que escribió Dayana).
 * - **Citas que no existen**: luego le dijo «Sí, queda confirmada para este
 *   sábado» sin haber agendado nada.
 * - **«Hoy mismo» / «en un momento»**: a Valentina, «Ya le aviso a Dayana para
 *   que se comunique con ustedes hoy mismo»; a Samy, «Dayana te estará
 *   llamando en unos momentos»; a «la negra bella», «intentamos de nuevo en un
 *   momento». Nadie las llamó.
 *
 * Pura: `run.ts` le da lo que respalda la respuesta (las horas de verdad y si
 * hay una cita) y no envía si hay una falta. La usan también los
 * calificadores de la evaluación. Se mira frase por frase: una frase sobre el
 * webinar, el curso o un pago no cuenta como promesa de una llamada.
 */

export type PromiseBreach = "invented_slots" | "false_booking" | "same_day_promise" | "recordings";

/** «10:00 a. m.», «4 p.m.», «8:45 pm», «10 de la mañana» → «10:00a». */
const TIME_AMPM = /\b(\d{1,2})(?::([0-5]\d))?\s*(?:([ap])\.?\s?m\b\.?|de la (manana|tarde|noche))/g;
/** «18:45» (24 h) → «6:45p». */
const TIME_24H = /\b(1[3-9]|2[0-3]):([0-5]\d)\b/g;
/** «a las 10», «a las 4:30» sin a. m./p. m.: la hora sin mañana ni tarde («10:00»). */
const TIME_BARE = /\ba las (\d{1,2})(?::([0-5]\d))?(?![\d:])(?!\s*(?:[ap]\.?\s?m\b|de la\b|hora))/g;

/**
 * Las horas que menciona un texto, normalizadas: «10:00a», «4:00p»; las que no
 * dicen mañana o tarde quedan sin letra («10:00»).
 */
export const timesIn = (text: string): string[] => {
  const folded = foldForSearch(text);
  const out = new Set<string>();
  for (const m of folded.matchAll(TIME_AMPM)) {
    const hour = Number(m[1]);
    if (!hour || hour > 12) continue;
    const ap = m[3] ?? (m[4] === "manana" ? "a" : "p");
    out.add(`${hour}:${m[2] ?? "00"}${ap}`);
  }
  for (const m of folded.matchAll(TIME_24H)) out.add(`${Number(m[1]) - 12}:${m[2]}p`);
  for (const m of folded.matchAll(TIME_BARE)) {
    const hour = Number(m[1]);
    if (!hour || hour > 12) continue;
    const key = `${hour}:${m[2] ?? "00"}`;
    if (!out.has(`${key}a`) && !out.has(`${key}p`)) out.add(key);
  }
  return [...out];
};

const WEEKDAY = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/g;
/** Los días de la semana que nombra un texto («viernes»). */
export const weekdaysIn = (text: string): string[] => [...new Set(foldForSearch(text).match(WEEKDAY) ?? [])];

/** ¿Esta hora está respaldada? Una hora sin a. m./p. m. vale si coincide con cualquiera de las dos. */
const backed = (time: string, allowed: Set<string>) =>
  allowed.has(time) || (!/[ap]$/.test(time) && (allowed.has(`${time}a`) || allowed.has(`${time}p`)));

/** Habla de agendar o de horas para una llamada o una cita («a las 6:30 p. m. te queda bien»). */
const SCHEDULING = /(llam|cita|agend|horari|disponib|espacio|opcion|reserv|te queda bien|te sirve|que dia)/;
/** Una frase sobre un evento, el curso o un pago: esas horas y esas «confirmaciones» no son de una llamada. */
const NOT_A_CALL = /(webinar|evento|taller|curso|clase|en vivo|\blive\b|grupo|sesion grupal|inscripci|inscrit|cupo|pago|comprobante|transferencia|deposito|consignacion)/;

const DAY = "(lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|hoy)";

/**
 * «queda confirmada», «quedó tu llamada el jueves», «ya te agendé», «tu llamada
 * está agendada», «Dayana te llama el sábado». No: «¿quieres que te agende?»,
 * «tu llamada queda para cuando elijas», «Dayana te llama por WhatsApp».
 */
const BOOKING_CLAIM = new RegExp(
  [
    "(queda(s|n|ste)?|quedo|quedaria)\\s+(totalmente\\s+|entonces\\s+)?(confirmad|agendad|reservad)",
    "(queda|quedo)\\s+(tu|la)\\s+(cita|llamada)\\b",
    "esta(s)?\\s+(confirmad|agendad|reservad)",
    "ya\\s+(te\\s+)?(agende|reserve|confirme)\\b",
    "(?<!que\\s)\\bte\\s+(agende|reserve)\\s+(para|el|la|tu)\\b",
    // «tu llamada con Dayana queda para hoy», «tu llamada gratis quedó para el viernes»
    // (Natalia, Barbara, Alexandra, Caicedo, 21-oct: el «con Dayana» la dejaba pasar).
    `tu\\s+(cita|llamada)(\\s+gratis|\\s+gratuita|\\s+con\\s+dayana|\\s+de\\s+15\\s+minutos)*\\s+(queda|esta|quedo)\\s+(confirmad|agendad|reservad|para\\s+(el\\s+|este\\s+|esta\\s+)?(${DAY}|las\\s+\\d|\\d))`,
    `(queda|quedo)\\s+para\\s+(el\\s+|este\\s+|esta\\s+)?(${DAY}|las\\s+\\d)`,
    `dayana\\s+te\\s+(llama|llamara|va\\s+a\\s+llamar)\\s+(el\\s+${DAY}|este\\s+${DAY}|esta\\s+(tarde|noche)|${DAY}|a\\s+las\\s+\\d)`,
  ].join("|")
);

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

/** ¿La respuesta promete algo que nada respalda? `null` si está bien. */
export const promiseBreach = (input: PromiseCheck): PromiseVerdict => {
  // «6:30 p. m.» → «6:30 pm»: si no, el punto de «p.» corta la frase y la hora se pierde.
  const folded = foldForSearch(input.text).replace(/\b([ap])\.\s?m\b\.?/g, "$1m");
  if (!folded.trim()) return null;
  const sentences = sentencesOf(folded).filter((s) => !NOT_A_CALL.test(s));

  const recorded = sentencesOf(folded).find((s) => RECORDING.test(s) && !NEGATED.test(s));
  if (recorded) return { breach: "recordings", detail: recorded.match(RECORDING)![0] };

  const allowed = new Set(input.backing.flatMap(timesIn));
  const allBacked = (s: string) => {
    const times = timesIn(s);
    return times.length > 0 && times.every((t) => backed(t, allowed));
  };
  /** Pregunta con horas que dio la agenda: ofrece, no afirma. */
  const backedQuestion = (s: string) => allBacked(s) && OFFER.test(s);
  const bookedTimes = new Set((input.bookedLabels ?? []).flatMap(timesIn));
  const bookedDays = new Set((input.bookedLabels ?? []).flatMap(weekdaysIn));
  for (const s of sentences) {
    const claim = s.match(BOOKING_CLAIM);
    // «¿Te parece si Dayana te llama hoy a las 4:00 p. m.?» con esa hora de la agenda: es una oferta.
    if (!claim || (s.includes("?") && backedQuestion(s))) continue;
    if (!input.hasBooking) return { breach: "false_booking", detail: claim[0] };
    // Hay cita, pero lo que confirma es otro día u otra hora. Se mira desde la
    // confirmación: «ya no es el jueves: tu llamada queda para el viernes…» vale.
    if (input.bookedLabels?.length) {
      const claimed = s.slice(claim.index ?? 0);
      const otherTime = timesIn(claimed).some((t) => !backed(t, bookedTimes));
      const otherDay = weekdaysIn(claimed).some((d) => !bookedDays.has(d));
      if (otherTime || otherDay) return { breach: "false_booking", detail: claim[0] };
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
  const invented = sentences
    .filter((s) => SCHEDULING.test(s))
    .flatMap((s) => timesIn(s))
    .filter((t) => !backed(t, allowed));
  if (invented.length) return { breach: "invented_slots", detail: [...new Set(invented)].join(", ") };
  return null;
};

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
