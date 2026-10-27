import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { foldForSearch } from "../search-normalize";

/**
 * El flujo de primera vez (pedido de la dueña): la asistente personal de
 * Dayana saluda, pregunta cómo está y de dónde escribe, escucha, encuentra lo
 * que mueve a la persona a buscar ayuda (los «botones», un concepto interno
 * que nunca se le dice), hace la pregunta clave para eso e invita a la llamada
 * gratis de 15 minutos, con horas reales del calendario. Dayana cierra la
 * venta en la llamada.
 *
 * Puro: arma el texto del prompt y el «ya hecho / siguiente paso» a partir de
 * la conversación, para que no repita pasos ni salude dos veces.
 */

export type FlowLine = { direction: "INBOUND" | "OUTBOUND"; body: string | null };

export type FlowState = {
  greeted: boolean;
  askedFeeling: boolean;
  askedCountry: boolean;
  keyQuestion: boolean;
  invited: boolean;
  offeredSlots: boolean;
  declined: boolean;
};

const GREETING = /\b(hola|te bendigo|buen(os|as) (dias|tardes|noches))\b/;
const FEELING = /\bcomo (estas|te sientes|te has sentido|te encuentras|vas)\b/;
const COUNTRY = /\b(desde que (pais|ciudad)|de donde (me )?escribes|en que (pais|ciudad) (estas|vives))\b/;
const KEY_QUESTION = /\bcuanto tiempo mas\b/;
const INVITE = /\bllamada (gratis|gratuita)|\bconsulta (gratis|gratuita)|\b15 minutos\b/;
const SLOTS = /\b(tu hora|en colombia)\b/;
// «Ya no quiero sentirme así», «no puedo seguir con esto» hablan de lo que le
// pasa, no de la llamada (Naty, 18-oct: dijo eso y la IA se despidió con
// «Quedamos en contacto»; después dijo «Si» y se despidió otra vez).
const PROBLEM_VERB = "(seguir|sentir\\w*|vivir|estar|cargar|tener|continuar|volver|pasar|sufrir|avanzar|dormir|aguantar|soportar|que (me|siga|sigan))";
const DECLINE = new RegExp(
  `\\b(no (puedo|quiero)(?! ${PROBLEM_VERB})|no me interesa|no gracias|no por ahora|despues te (digo|escribo|aviso)|mas adelante|ahorita no|otro dia)\\b`
);
/** Después de decir que no (o de que se leyera así), un «sí» a la llamada lo deshace. */
const ACCEPT = /^(si|sii+|claro|dale|de una|ok|okay|bueno|listo)\b|\b(si (quiero|deseo|me gustaria)|(quiero|deseo|me gustaria) (la llamada|agendar|que me llame)|si,? (por favor|claro))\b/;

export const flowState = (
  lines: FlowLine[],
  /**
   * `isInvite`: otro mensaje nuestro que también la invita a la llamada (la del
   * taller, que no dice «gratis»). Cuenta desde ese mensaje y deja atrás un «no»
   * de antes (revisión 24-oct: marcado desde el principio, un «más adelante» viejo
   * se leía como «no» a esta invitación).
   */
  opts: { keyQuestions?: string[]; offeredSlots?: boolean; isInvite?: (line: FlowLine) => boolean } = {}
): FlowState => {
  const keys = (opts.keyQuestions ?? []).map((q) => foldForSearch(q).slice(0, 30)).filter((q) => q.length >= 12);
  const state: FlowState = {
    greeted: false,
    askedFeeling: false,
    askedCountry: false,
    keyQuestion: false,
    invited: false,
    offeredSlots: Boolean(opts.offeredSlots),
    declined: false,
  };
  for (const line of lines) {
    const text = foldForSearch(line.body ?? "");
    if (!text) continue;
    if (line.direction === "OUTBOUND") {
      if (GREETING.test(text)) state.greeted = true;
      if (FEELING.test(text)) state.askedFeeling = true;
      if (COUNTRY.test(text)) state.askedCountry = true;
      if (KEY_QUESTION.test(text) || keys.some((k) => text.includes(k))) state.keyQuestion = true;
      if (INVITE.test(text)) state.invited = true;
      if (opts.isInvite?.(line)) {
        state.invited = true;
        state.declined = false;
      }
      if (SLOTS.test(text)) state.offeredSlots = true;
    } else if (state.invited && DECLINE.test(text)) {
      state.declined = true;
    } else if (state.declined && ACCEPT.test(text.replace(/[,.!¡¿?]+/g, " ").trim())) {
      state.declined = false;
    }
  }
  return state;
};

/** Un «sí» a la invitación: también «Excelente», «si porfavor», «me interesa», «perfecto». */
const SAYS_YES =
  /^(si|sii+|claro|dale|de una|ok|okay|okey|vale|bueno|listo|perfecto|excelente|exelente|genial|me parece|de acuerdo|por supuesto|con gusto|me encantaria|esta bien|obvio)\b|\b(si (quiero|deseo|me gustaria|por favor|porfavor|claro|me interesa)|(quiero|deseo|me gustaria|me encantaria) (la llamada|agendar|que me llame|hablar con)|me interesa)\b/;
/** Lo que le pregunta la asistente camino a las horas: el país, la ciudad, el nombre, qué día o franja prefiere. */
const FLOW_QUESTION = /\b(pais|ciudad|con quien tengo el gusto|(que|cual(es)?) (dia|dias|horario|horarios|hora|franja)|prefieres|te queda mejor|te sirve mejor)\b/;
/** Ya tiene horas (la lista del código, «en tu hora / en Colombia») o la cita. */
const HOURS_GIVEN = /\b(tu hora|en colombia|hora de colombia|cual de estas|quedo para|queda para|ya esta agendada)\b|\b[ap]\. ?m\./;
/** Nuestro aviso de espera («Déjame consultarlo con Dayana…»): no corta el camino a las horas. */
const HOLDING = /\b(dejame (consultarlo|confirmarlo|revisarlo|verificarlo)|(le|se lo) (paso|aviso|comento|consulto)\b[^.]*\bdayana|te confirmo por aqui)\b/;
const WEEKDAY = "(lunes|martes|miercoles|jueves|viernes|sabado|domingo)s?";
/** Le contesta cuándo puede: días, «fines de semana», «de noche», «a las 20:00», «todos los días», «puedo». */
const AVAILABILITY = new RegExp(
  `\\b(${WEEKDAY}|fin(es)? de semana|entre semana|todos los dias|(de|en la|por la|en las|por las) (noche|tarde|manana)s?|(a|de|desde) las? \\d{1,2}|\\d{1,2}(:\\d{2})? ?(hs|am|pm|a\\.? ?m|p\\.? ?m)|puedo|me queda|me sirve|disponible)\\b`
);

/**
 * Dijo que sí a la llamada gratis y todavía no le llegaron horas (Moi, Belén,
 * Ana, 21–26 oct): a «Exelente» la asistente le preguntó «¿qué días o en qué
 * horario prefieres?», a «si porfavor» el país y la ciudad tres veces, y nunca
 * usó offer_free_call_slots. Desde la última invitación: un sí suyo sin un «no»
 * después, ninguna hora nuestra, y lo último nuestro es la invitación o una
 * pregunta del camino (país, ciudad, qué día). Lo que escribió ahora no es un «no».
 */
export const acceptedCallWithoutHours = (lines: FlowLine[]): boolean => {
  let end = lines.length;
  while (end > 0 && lines[end - 1].direction === "INBOUND") end--;
  const burst = lines.slice(end).map((l) => foldForSearch(l.body ?? "")).filter(Boolean);
  if (!burst.length || end === 0) return false;
  if (burst.some((t) => DECLINE.test(t))) return false;
  // Hacia atrás por nuestros mensajes del camino (invitación, país, ciudad, qué día):
  // la primera invitación de ese tramo. Las preguntas también dicen «llamada gratis».
  let invite = -1;
  for (let i = end - 1; i >= 0; i--) {
    if (lines[i].direction === "INBOUND") continue;
    const text = foldForSearch(lines[i].body ?? "");
    if (!text) continue;
    if (HOURS_GIVEN.test(text)) return false;
    if (INVITE.test(text)) invite = i;
    else if (!FLOW_QUESTION.test(text) && !HOLDING.test(text)) break;
  }
  if (invite < 0) return false;
  // Un sí, o decirle cuándo puede a la invitación o a «¿qué días puedes?» (Adrienne,
  // 26-oct: «Horario de Argentina solo de noche a las 20:00»).
  let yes = false;
  for (const line of lines.slice(invite + 1)) {
    const text = foldForSearch(line.body ?? "");
    if (!text || line.direction === "OUTBOUND") continue;
    if (DECLINE.test(text)) {
      yes = false;
    } else if (SAYS_YES.test(text.replace(/[,.!¡¿?]+/g, " ").trim()) || AVAILABILITY.test(text)) {
      yes = true;
    }
  }
  return yes;
};

/**
 * Cuándo dijo que puede, para buscar las horas como lo haría la herramienta
 * (`dias` / `franja`): lo último que dijo manda; «todos los días» quita los días;
 * «fines de semana» = sábado y domingo; «entre semana» = lunes a viernes; una hora
 * («a las 20:00», «8 pm») da la franja. Lo que habla de las sesiones pagas
 * («para sesión puedo los sábados», Adrienne) no cuenta: es para la llamada.
 */
export const availabilityArgs = (texts: string[]): { dias?: string[]; franja?: "mañana" | "tarde" | "noche" } => {
  let dias: string[] = [];
  let franja: "mañana" | "tarde" | "noche" | undefined;
  for (const raw of texts) {
    const t = foldForSearch(raw);
    if (!t || /\bsesion(es)?\b/.test(t) || /\bno (puedo|me queda|me sirve)\b/.test(t)) continue;
    if (/\btodos los dias\b/.test(t)) dias = [];
    else if (/\bfin(es)? de semana\b/.test(t)) dias = ["sabado", "domingo"];
    else if (/\bentre semana\b/.test(t)) dias = ["lunes", "martes", "miercoles", "jueves", "viernes"];
    else {
      const named = [...t.matchAll(new RegExp(`\\b${WEEKDAY}\\b`, "g"))].map((m) => m[1]);
      if (named.length) dias = [...new Set(named)];
    }
    const part = t.match(/\b(?:de|en la|por la|en las|por las|a la) (noche|tarde|manana)s?\b/)?.[1];
    const hour =
      t.match(/\b(?:a|de|desde) las? (\d{1,2})(?::\d{2})?(?: ?(hs|am|pm|a\.? ?m|p\.? ?m)\b)?/) ?? t.match(/\b(\d{1,2})(?::\d{2})? ?(hs|am|pm|a\.? ?m|p\.? ?m)\b/);
    if (part) franja = part === "manana" ? "mañana" : part === "tarde" ? "tarde" : "noche";
    else if (hour) {
      const h = Number(hour[1]) + (/^p/.test(hour[2] ?? "") && Number(hour[1]) < 12 ? 12 : 0);
      franja = h >= 18 ? "noche" : h >= 12 ? "tarde" : h >= 6 ? "mañana" : franja;
    }
  }
  return { ...(dias.length ? { dias } : {}), ...(franja ? { franja } : {}) };
};

/**
 * Lo que va encima de las horas que buscó el código cuando el modelo no las
 * buscó: su frase sin lo que pregunta (qué día, qué franja, el país: la lista ya
 * responde) y nada si queda casi vacía (Ana, 26-oct: «Ciudad de México», solo).
 */
export const leadBeforeHours = (text: string): string => {
  const kept = text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((s) => !/[?¿]/.test(s) && !/\b(dime|cuentame|indicame|escribeme)\b/.test(foldForSearch(s)) && !FLOW_QUESTION.test(foldForSearch(s)))
    .join(" ")
    .trim();
  return kept.split(/\s+/).filter(Boolean).length >= 3 ? kept : "";
};

/** El siguiente paso del flujo según lo que ya se hizo. */
export const nextStep = (s: FlowState): string => {
  if (s.declined) return "dijo que no o que después: no insistas; despídete con calidez y deja la puerta abierta";
  if (!s.greeted) return "saludar como asistente de Dayana y preguntar cómo está";
  if (!s.askedCountry) return "preguntar desde qué país (y ciudad, si el país tiene varias horas) escribe";
  if (!s.keyQuestion && !s.invited) return "escuchar lo que le pasa; cuando aparezca lo que la mueve, hacer su pregunta clave";
  if (!s.invited) return "invitar a la persona a la llamada gratis de 15 minutos con Dayana";
  if (!s.offeredSlots) return "si aceptó, ofrecerle horas con offer_free_call_slots";
  return "si eligió una hora, agendarla con book_free_call; si no, ayudar a la persona a elegir";
};

export const flowStateText = (s: FlowState): string => {
  const done = [
    s.greeted && "saludo",
    s.askedFeeling && "preguntar cómo está",
    s.askedCountry && "preguntar de dónde escribe",
    s.keyQuestion && "pregunta clave",
    s.invited && "invitación a la llamada gratis",
    s.offeredSlots && "horas ofrecidas",
  ].filter(Boolean);
  return [
    done.length ? `YA HECHO EN ESTE CHAT (no lo repitas): ${done.join(", ")}.` : "YA HECHO EN ESTE CHAT: nada todavía.",
    `SIGUIENTE PASO: ${nextStep(s)}.`,
  ].join("\n");
};

/** Las reglas de la persona nueva y de la que ya conversó, con el flujo de la dueña. */
export const salesFlowRules = (config: WhatsAppAiConfig, opts: { autoBook: boolean }): string => {
  const keyQuestions = config.salesFlow.buyButtons
    .filter((b) => b.enabled)
    .map((b) => `    · ${b.label}: «${b.keyQuestion}»`)
    .join("\n");
  const booked = opts.autoBook
    ? "Queda agendada al instante: confírmale el día y la hora (en su hora) y que Dayana llama por WhatsApp a este número."
    : "Queda lista para que Dayana la confirme: dile que en un momento le confirmamos la hora por aquí.";
  return `- Eres la ASISTENTE PERSONAL de Dayana (no eres Dayana). Puedes usar su calidez y su forma de hablar, pero hablas como su asistente: «Dayana te escucha», «te agendo con Dayana». La llamada es entre Dayana y la persona: tú no estás en ella. Así sí: «Tu llamada queda para el jueves a las 3:00 p. m.», «Dayana te llama por WhatsApp». Así no: «Quedamos agendadas», «Quedamos confirmadas», «Te llamo», «Nos vemos el jueves».
- Responde SIEMPRE primero a lo último que dijo la persona y solo después das el siguiente paso. Si pregunta algo, contéstalo; si cuenta algo, reconócelo en una frase. Nunca lo ignores para hacer tu siguiente pregunta. Ejemplo: PERSONA «Me acabas de pasar tu número» → «Sí, Fernando, este es el WhatsApp de Dayana; aquí te atiendo yo, su asistente. ¿Cómo estás?» (no «¿Desde qué país me escribes?» sin más).
- Horas: si la persona dice una hora en la otra zona (por ejemplo la de Colombia) o duda, aclárale que es la misma: «Sí, Rosa: las 6:15 p. m. de Colombia son las 8:15 p. m. de tu hora».
- PERSONA NUEVA (mira SITUACIÓN DEL CHAT y YA HECHO): tu único objetivo es que agende la LLAMADA GRATIS de 15 minutos con Dayana (sin costo ni compromiso; Dayana es quien explica los procesos y cierra en la llamada). Un paso por mensaje, en este orden, sin saltarte ninguno ni repetir lo que ya se hizo:
  1. Saludo: «Hola [nombre], te bendigo. Soy la asistente de Dayana. ¿Cómo estás?». Si no sabes su nombre: «Hola, te bendigo. Soy la asistente de Dayana. ¿Con quién tengo el gusto?». Si en ese primer mensaje ya pidió algo (información de las terapias, de un curso, agendar), dile en el mismo saludo que con gusto le ayudas con eso («…y con gusto te doy la información de las terapias»).
  2. De dónde escribe: «¿Desde qué país me escribes?» (y la ciudad en México, Estados Unidos, Brasil, Canadá, España, Argentina o Chile). Cuando lo diga, usa save_country.
  3. Escucha lo que le pasa (emocional, económico, de pareja, de salud…). Refleja en UNA frase lo que siente, con sus propias palabras. No la interrogues.
  4. Cuando aparezca lo que la mueve a buscar ayuda, haz SU pregunta clave (lista abajo), una sola vez. Es interno: nunca digas «botón», ni categorías, ni que estás siguiendo un guion.
  5. Invitación: «Si quieres, te agendo una llamada gratis de 15 minutos con Dayana, sin costo ni compromiso. Ella te escucha y te dice cómo te puede ayudar.»
  6. Si acepta: usa offer_free_call_slots y escríbele las horas tal cual salen (en su hora y la de Colombia), 2 o 3. Nunca le des horas en el mismo mensaje en que le preguntas el país o la ciudad: primero saber dónde está, después las horas. Cuando elija una, usa book_free_call con esa hora exacta. ${booked} Si ninguna le sirve o dice que no puede esos días, pregúntale qué día y en qué franja puede (si no lo dijo) y vuelve a usar offer_free_call_slots con lo que dijo (dias / noPuede / franja / desde): se agenda cuando ella pueda. Si ya quedó agendada y la persona confirma («sí», «perfecto», «a esa hora») o repite la hora, no la agendes otra vez: confírmale la que tiene.
  7. Si dice que no o que después: no insistas (si es porque no le alcanza el dinero, mira COMUNIDAD Y OPCIONES MÁS ECONÓMICAS). «Listo, perfecto. Quedamos en contacto; si necesitas algo, me escribes por aquí.»
  Si la persona ya pide la llamada o dice cuándo puede («hoy o mañana», «el jueves»), no la hagas esperar con los pasos 3–5: si sabes dónde está, ofrécele las horas (offer_free_call_slots, con dias / franja si dijo cuándo puede) ya; si no, pregúntale solo eso.
  PREGUNTAS CLAVE (según lo que la mueve):
${keyQuestions}
  Si lo que la mueve no está en la lista, usa «¿Cuánto tiempo más quieres seguir así?».
- Lo emocional y lo que cuente de su vida (tristeza, ansiedad, duelo, autoestima, soledad…) NO es motivo para pasarle el chat a Dayana: es justo lo que Dayana trabaja. Una frase de apoyo y sigue el flujo hacia la llamada gratis.
- PERSONA CON CONVERSACIÓN PREVIA: lee el hilo y la FICHA y sigue donde quedó: no la saludes como nueva ni repitas preguntas que ya respondió. Si ya se la invitó y no agendó, retoma con suavidad desde lo que le pasaba. Si quiere agendar la llamada gratis: offer_free_call_slots y book_free_call. Si quiere cambiar o cancelar una cita que ya tiene, escala con category=reschedule. Si no sabes qué decir, escala con category=unknown.
`;
};
