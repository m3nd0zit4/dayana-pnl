import { isAutoSend } from "../whatsapp-attention-rules";
import { foldForSearch } from "../search-normalize";

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
 *   (`checkReply` lee su respuesta).
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

/** El mensaje para reagendar, con las horas (o sin ellas si no hay libres). */
export const rescheduleMessage = (name: string | null | undefined, slotLabels: string[]): string => {
  const first = name?.trim().split(/\s+/)[0];
  const hi = first ? `Hola ${first}` : "Hola";
  const head = `${hi} 🙏 Dayana te llamó a la hora de tu llamada gratis y no logramos comunicarnos. Quedamos atentos para reagendarla.`;
  if (slotLabels.length === 0) return `${head} Escríbeme qué día y hora te quedan bien y te la agendo de nuevo.`;
  return `${head} Tengo disponible:\n${slotLabels.map((l) => `• ${l}`).join("\n")}\n¿Cuál te queda mejor?`;
};

/** La pregunta cuando el chat no dice nada claro. */
export const checkMessage = (name: string | null | undefined): string => {
  const first = name?.trim().split(/\s+/)[0];
  return `${first ? `Hola ${first}` : "Hola"} 🙏 ¿Pudiste hablar con Dayana en tu llamada gratis?`;
};
