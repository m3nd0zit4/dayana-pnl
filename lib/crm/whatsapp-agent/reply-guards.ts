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
const TOOL_TEXT = /^[^\n]*\b[a-z]+_[a-z_]+\s*\([^)\n]*\)[^\n]*$/gim;
export const withoutToolText = (text: string): { text: string; had: boolean } => {
  const cleaned = text.replace(TOOL_TEXT, "").replace(/\n{3,}/g, "\n\n").trim();
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
