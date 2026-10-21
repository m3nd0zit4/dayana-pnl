import { foldForSearch } from "../search-normalize";
import { isAutoSend } from "../whatsapp-attention-rules";

/**
 * Lo que se mira antes de mandar una respuesta, en reglas puras (revisión de
 * los chats del 21-oct, pedido del dueño: «que entienda que la persona le está
 * respondiendo a Dayana», «quita lo que cause errores»).
 */

type Msg = {
  direction: string;
  body?: string | null;
  isAutoReply?: boolean;
  source?: string | null;
  clientKey?: string | null;
  kind?: string | null;
  status?: string | null;
};

/** «Con gusto, Alexandra. Te bendigo 🙏», «Te bendigo 🙏», «A ti, con gusto»: un cierre, no una respuesta. */
const CLOSING = /^(con (mucho )?gusto|te bendigo|bendiciones|a ti|amen|igualmente|gracias a ti|un abrazo|feliz (dia|tarde|noche)|que tengas)\b/;

export const isClosingLine = (body: string | null | undefined): boolean => {
  const t = foldForSearch(body ?? "").replace(/[^\p{L}\p{N}\s?]/gu, " ").replace(/\s+/g, " ").trim();
  return Boolean(t) && t.length <= 60 && !t.includes("?") && CLOSING.test(t);
};

/**
 * La persona mandó solo un «gracias», un «amén» o un emoji: ¿hace falta un
 * «Con gusto»? No si lo último nuestro antes de eso ya fue un cierre (Carmen,
 * 21-oct: «Te bendigo, Carmen 🙏» / «Igualmente» / «Te bendigo, Carmen 🙏 Con
 * gusto») ni si lo último lo escribió Dayana: le está contestando a ella
 * (Patricia, 20-oct: cinco «Con gusto, Patricia 🙏» a lo que le decía a Dayana).
 * Mensajes del más nuevo al más viejo.
 */
export const closingNotNeeded = (messagesNewestFirst: Msg[]): boolean => {
  const prev = messagesNewestFirst.find(
    (m) => m.direction === "OUTBOUND" && m.kind !== "system" && m.status !== "FAILED" && !isAutoSend(m)
  );
  if (!prev) return false;
  if (isDayanaOwn(prev)) return true;
  return isClosingLine(prev.body);
};

/**
 * Lo escribió Dayana ella misma (celular o CRM): no la IA, ni un envío
 * automático o masivo (`bulk:` sale sin `isAutoReply`), ni una propuesta de la
 * IA que ella aprobó (`approval`).
 */
export const isDayanaOwn = (m: { direction: string; isAutoReply?: boolean; source?: string | null; clientKey?: string | null }): boolean =>
  m.direction === "OUTBOUND" && !m.isAutoReply && m.source !== "approval" && !isAutoSend(m);

/**
 * ¿Lo último antes de lo que escribió la persona lo escribió Dayana ella
 * misma? Entonces le está respondiendo a ella. Mensajes en orden.
 */
export const answeringDayana = (
  lines: { direction: string; isAutoReply?: boolean; source?: string | null; clientKey?: string | null; body?: string | null }[]
): boolean => {
  let i = lines.length;
  while (i > 0 && lines[i - 1].direction === "INBOUND") i--;
  if (i === lines.length || i === 0) return false;
  return isDayanaOwn(lines[i - 1]);
};

/**
 * Una herramienta escrita como texto en vez de usarla (Ruben, 19-oct: le
 * llegó «Save_country(city="New York", countryIso="US", …)»). Se quita la
 * línea; `had`: había alguna.
 */
/** Las herramientas de la asistente, sin guiones bajos ni mayúsculas («Escalate», «save_country», «SendPaymentInfo»). */
const TOOL_NAMES = new Set(
  [
    "book_appointment",
    "book_free_call",
    "check_availability",
    "confirm_appointment",
    "escalate",
    "no_reply",
    "offer_free_call_slots",
    "offer_times",
    "register_payment_receipt",
    "request_booking",
    "save_country",
    "search_past_chats",
    "send_affordable_option",
    "send_community_link",
    "send_payment_info",
    "send_payment_link",
    "send_sticker",
    "send_urgent_session_link",
  ].map((n) => n.replace(/_/g, ""))
);
const toolKey = (name: string) => name.toLowerCase().replace(/^default_api\./, "").replace(/_/g, "");

/**
 * Una línea que es una llamada a herramienta escrita como texto: el nombre de
 * una herramienta (con o sin guiones, mayúsculas, `default_api.`) seguido de
 * «(…)», o cualquier nombre con argumentos `clave=valor`. Natalia, 21-oct:
 * «Escalate(category=other,holdingReply=Déjame consultarlo…,reason=…)» — sin
 * guion bajo no lo veía la regla anterior.
 */
const CALL_LINE = /^\s*[*_`]*\s*((?:default_api\.)?[A-Za-z][A-Za-z_]*)\s*\(([\s\S]*)\)\s*[*_`.]*\s*$/;

/** Los argumentos `clave=valor` (los valores pueden llevar comas y paréntesis). */
const parseArgs = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*([\s\S]*?)(?=,\s*[A-Za-z_][A-Za-z0-9_]*\s*[=:]|$)/g;
  for (const m of raw.matchAll(re)) out[m[1]] = m[2].trim().replace(/^["'«]|["'»]$/g, "").trim();
  return out;
};

export const pseudoToolCall = (line: string): { name: string; args: Record<string, string> } | null => {
  const m = line.match(CALL_LINE);
  if (!m) return null;
  const known = TOOL_NAMES.has(toolKey(m[1]));
  const args = parseArgs(m[2]);
  if (!known && Object.keys(args).length === 0) return null;
  return { name: toolKey(m[1]), args };
};

/**
 * Las otras formas en que Gemini escribe una llamada en el texto (error
 * conocido de flash-lite): pseudo-XML con `default_api`, un bloque
 * `tool_code` con `print(default_api.x(…))`, `<function=x>{…}</function>`.
 * Con una de estas no se rescata nada del mensaje: no sale.
 */
const CALL_MARKER = /\bdefault_api\b|\btool_code\b|<\/?\s*(function|tool_call)\b/i;
const MARKED_NAME = /default_api\s*[.:]\s*([A-Za-z][A-Za-z_]*)|<\s*function\s*=\s*([A-Za-z][A-Za-z_]*)|"name"\s*:\s*"([A-Za-z][A-Za-z_]*)"/;

/** Lo de dentro del paréntesis que abre en `open`, contando los anidados y sin mirar dentro de comillas. */
const insideParens = (text: string, open: number): string => {
  let depth = 0;
  let quote = "";
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
};

const markedArgs = (rest: string): Record<string, string> => {
  const paren = rest.match(/^\s*\(/);
  if (paren) return parseArgs(insideParens(rest, rest.indexOf("(")));
  const out: Record<string, string> = {};
  for (const m of rest.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = m[2] ?? m[3];
  const json = rest.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(json[0]) as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
    } catch {
      /* no es JSON: quedan los atributos */
    }
  }
  return out;
};

/** La primera llamada a herramienta escrita como texto en la respuesta (o null). */
export const findPseudoToolCall = (text: string): { name: string; args: Record<string, string> } | null => {
  // Primero la forma marcada: en «print(default_api.escalate(…))» la herramienta es escalate, no print.
  if (CALL_MARKER.test(text)) {
    const m = text.match(MARKED_NAME);
    if (m && m.index !== undefined) return { name: toolKey(m[1] ?? m[2] ?? m[3]), args: markedArgs(text.slice(m.index + m[0].length)) };
  }
  const whole = pseudoToolCall(text.trim());
  if (whole) return whole;
  for (const line of text.split("\n")) {
    const call = pseudoToolCall(line);
    if (call) return call;
  }
  return CALL_MARKER.test(text) ? { name: "", args: {} } : null;
};

const ESCALATE_CATEGORIES = ["payment", "unknown", "complaint", "clinical", "reschedule", "other"] as const;
export const PSEUDO_HOLDING = "Déjame consultarlo con Dayana y te confirmo por aquí.";

/**
 * ¿Hay que escalar de verdad por una herramienta escrita como texto? Una
 * escalada siempre (Natalia, 21-oct), con sus argumentos; cualquier otra solo
 * si no queda nada que enviar (`nothingLeft`): la persona recibe la espera y
 * Dayana el aviso, en vez de silencio.
 */
export const pseudoEscalation = (
  message: string,
  nothingLeft: boolean
): {
  category: (typeof ESCALATE_CATEGORIES)[number];
  severity: "urgent" | "normal";
  reason: string;
  holdingReply: string;
} | null => {
  if (!withoutToolText(message).had) return null;
  const call = findPseudoToolCall(message);
  if (!call) return null;
  if (call.name !== "escalate") {
    if (!nothingLeft) return null;
    return {
      category: "other",
      severity: "normal",
      reason: `La IA escribió «${call.name || "una herramienta"}» como texto en vez de usarla: no se envió. Contéstale tú.`,
      holdingReply: PSEUDO_HOLDING,
    };
  }
  return {
    category: ESCALATE_CATEGORIES.find((c) => c === call.args.category) ?? "other",
    severity: call.args.severity === "urgent" ? "urgent" : "normal",
    reason: (call.args.reason || "La IA escribió la escalada como texto.").slice(0, 200),
    holdingReply: withoutToolText(call.args.holdingReply ?? "").text || PSEUDO_HOLDING,
  };
};

export const withoutToolText = (text: string): { text: string; had: boolean } => {
  if (pseudoToolCall(text.trim()) || CALL_MARKER.test(text)) return { text: "", had: true };
  const kept = text.split("\n").filter((line) => !pseudoToolCall(line));
  const cleaned = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned, had: cleaned !== text.trim() };
};

/**
 * Un número de cuenta escrito por el modelo (eval 21-oct: «te comparto los
 * datos… Número de cuenta: 123-456789-00», inventado, sin send_payment_info).
 * Los datos de verdad van solo en los bloques que pega el código, que no
 * pasan por aquí.
 */
export const writesAccountNumber = (text: string): boolean => /\b\d[\d\s-]{8,}\d\b/.test(text);

/**
 * «Le paso tu mensaje a Dayana», «ya le aviso», «déjame consultarlo con
 * Dayana»: una promesa de que Dayana se entera. Si la IA no escaló, el código
 * le avisa igual (Ricky, 17-oct: «Le paso tu mensaje a Dayana para que lo
 * revise» y Dayana nunca recibió nada).
 */
const HANDOFF =
  /\b(le (paso|comento|aviso|cuento|consulto|transmito|hago llegar|dejo) (tu|su|el|este|esto|a dayana)|ya le (aviso|paso|comento)|dejame (consultarlo|avisarle|preguntarle|confirmarlo|comentarselo|pasarle)|dayana (te|le) (confirma|escribe|responde|contesta))/;
export const promisesHandoff = (text: string): boolean => HANDOFF.test(foldForSearch(text));
