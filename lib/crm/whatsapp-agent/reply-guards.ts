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
 * Los números largos de un texto (cuenta, cédula, teléfono), solo las cifras.
 * Un valor («1.860.000») no; una cédula con puntos de 10 cifras sí.
 */
const longNumbers = (text: string): string[] =>
  [...text.matchAll(/\d[\d \t.-]{5,}\d/g)]
    .map((m) => m[0].trim())
    .filter((n) => !(/^\d{1,3}(\.\d{3})+$/.test(n) && n.replace(/\D/g, "").length <= 9))
    .map((n) => n.replace(/\D/g, ""))
    .filter((d) => d.length >= 7);

/** Una línea de un bloque de datos: el banco solo, o «Titular: …», «N° Cuenta: …». */
const DATA_LABEL =
  /^(banco\w*( [a-z]+)?|bancolombia|nequi|daviplata|davivienda|bbva|western union)$|^(banco|nombre( del titular| del beneficiario)?|titular|beneficiario|a nombre de|tipo de cuenta|n[°º.o]* ?(de )?cuenta|numero de cuenta|cuenta( de ahorros| corriente| bancaria)?|documento|c\.?c\.?|cedula|nit|clabe|iban|swift|codigo swift|alias|ciudad|pais|telefono|celular|correo|e-?mail)\s*:|^(a nombre de|titular|beneficiario)\s/;
const PAY_WORD = /\b(nequi|daviplata|bancolombia|davivienda|bbva|western|banco|cuenta|titular|a nombre)\b/;

/**
 * Los datos de pago copiados a mano (ENNY, 23-oct: al seguimiento contestó
 * «me envías la forma de pago» y el modelo copió la cuenta de Bancolombia que
 * estaba más arriba en el chat; el freno de arriba la paró y le llegó «Déjame
 * confirmarlo con Dayana»). Si cada número que escribió está, cifra por cifra,
 * en unos datos de verdad, sus líneas salen de su texto y va el bloque de
 * verdad: el de Ajustes tal cual (`exact`), o las líneas de Dayana con esos
 * números (nunca las del modelo: el banco o el titular pueden estar mal). Un
 * número que no está en ninguno sigue frenado (puede ser inventado).
 */
export const typedPaymentData = (text: string, sources: { details: string; exact: boolean }[]): { text: string; block: string } | null => {
  const typed = longNumbers(text);
  if (!typed.length) return null;
  const source = sources.find((s) => {
    const real = new Set(longNumbers(s.details));
    return typed.every((d) => real.has(d));
  });
  if (!source) return null;
  const sourceLines = source.details.split("\n").map((l) => l.trim()).filter(Boolean);
  const sourceFolded = new Set(sourceLines.map((l) => foldForSearch(l)));
  const bare = (line: string) => foldForSearch(line).replace(/^[\s*_•-]+/, "").replace(/[\s*_]+$/, "").trim();
  const isData = (line: string) => longNumbers(line).length > 0 || sourceFolded.has(bare(line)) || DATA_LABEL.test(bare(line));
  // De Dayana: sus líneas con esos números y sus etiquetas; en una sola línea
  // («Hola bella, mi Nequi es 310…»), desde donde empiezan los datos.
  const fromDayana = sourceLines
    .filter((l) => longNumbers(l).some((d) => typed.includes(d)) || DATA_LABEL.test(bare(l)))
    .map((l) => {
      const at = foldForSearch(l).search(PAY_WORD);
      const cut = at > 0 && longNumbers(l.slice(0, at)).length === 0 ? l.slice(at) : l;
      return cut.charAt(0).toUpperCase() + cut.slice(1);
    });
  // Lo que queda del texto; «…los datos para el pago:» seguido de otra frase queda en punto.
  const kept: string[] = [];
  let dropped = false;
  for (const line of text.split("\n")) {
    if (isData(line)) {
      dropped = true;
      continue;
    }
    if (dropped && line.trim()) {
      const last = kept.findLastIndex((l) => l.trim());
      if (last >= 0) kept[last] = kept[last].replace(/:\s*$/, ".");
      dropped = false;
    }
    kept.push(line);
  }
  return {
    text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim().replace(/:$/, ""),
    block: source.exact ? source.details.trim() : fromDayana.join("\n"),
  };
};

const URL_CHARS = "[^\\s<>()[\\]\"'«»]+";
const URL_IN_TEXT = new RegExp(`(?:https?:\\/\\/|www\\.)${URL_CHARS}`, "gi");
/** Para lo conocido basta con parecer una dirección («dayanabeltran.com/eventos»). */
const ANY_URL = new RegExp(`(?:https?:\\/\\/|www\\.)${URL_CHARS}|\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)+\\/${URL_CHARS}`, "gi");
/** «*https://x.co/a*.» → el enlace y lo que lo envuelve o cierra la frase. */
const splitUrl = (raw: string) => {
  const m = raw.match(/^(.*?)([*_~`.,;:!?…]*)$/) ?? [raw, raw, ""];
  return { url: m[1], tail: m[2] };
};
/** Como se comparan: sin http ni www, el dominio en minúscula, sin «?…», «#…» ni la barra final (la ruta se respeta: un token de /pagar/ distingue mayúsculas). */
const urlKey = (raw: string) => {
  const [hostPath] = splitUrl(raw).url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[?#]/);
  const slash = hostPath.indexOf("/");
  const host = (slash < 0 ? hostPath : hostPath.slice(0, slash)).toLowerCase();
  return host + (slash < 0 ? "" : hostPath.slice(slash).replace(/\/+$/, ""));
};

/** Las direcciones de unos textos, como se comparan. */
export const urlKeys = (...texts: (string | null | undefined)[]): Set<string> =>
  new Set(texts.flatMap((t) => [...(t ?? "").matchAll(ANY_URL)].map((m) => urlKey(m[0]))));

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Un enlace que el modelo escribió sin haberlo leído en una fuente de verdad
 * (las reglas, los DATOS, lo que escribieron Dayana o la persona, los envíos
 * automáticos; no lo que escribió antes la IA): Ruth (23-oct) pidió el de la
 * comunidad y le llegó «Https://www.dayanabeltran.com/comunidad:», una página
 * que no existe, encima del enlace de verdad. No sale; el de verdad lo pega el
 * código. La portada del sitio (`siteHosts`) sí vale, y una ruta del sitio
 * escrita sin «https» («dayanabeltran.com/comunidad») también se mira. Los
 * que quedan salen con «https» en minúscula.
 */
export const withoutInventedUrls = (text: string, known: Set<string>, siteHosts: string[] = []): { text: string; removed: string[] } => {
  const removed: string[] = [];
  const bareSite = siteHosts.length ? `|\\b(?:www\\.)?(?:${siteHosts.map(escapeRe).join("|")})\\/${URL_CHARS}` : "";
  const pattern = new RegExp(`${URL_IN_TEXT.source}${bareSite}`, "gi");
  const lines = text.split("\n").map((line) => {
    let hit = false;
    const out = line.replace(pattern, (raw) => {
      const key = urlKey(raw);
      if (known.has(key) || siteHosts.includes(key)) return raw.replace(/^https?:/i, (s) => s.toLowerCase());
      hit = true;
      removed.push(splitUrl(raw).url);
      // La puntuación que cerraba la frase se queda; el «*» o los dos puntos no.
      return splitUrl(raw).tail.replace(/[^.!?…]/g, "");
    });
    if (!hit) return out;
    return (
      out
        // El «*» que abría un enlace en negrita.
        .replace(/(^|\s)[*_~`]+(?=\s|[.!?…]|$)/g, "$1")
        .replace(/[ \t]{2,}/g, " ")
        // «Mira <enlace> o <enlace>.» → «Mira.»: la «o» / «y» que quedó colgando.
        .replace(/\s+(?:o|y|u|e)(?=\s*[.,;:!?…]|\s*$)/gi, "")
        .replace(/[ \t]+$/, "")
        .replace(/\s+([.,;:!?])/g, "$1")
        // «Aquí está: <enlace>. Te bendigo» → «Aquí está. Te bendigo».
        .replace(/:([.!?…])/g, "$1")
        .replace(/:$/, "")
    );
  });
  if (!removed.length) return { text: lines.join("\n"), removed };
  return {
    text: lines
      .filter((l, i, all) => l.trim() || (i > 0 && all[i - 1].trim()))
      .join("\n")
      .replace(/^[\s:]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    removed,
  };
};

/**
 * «Le paso tu mensaje a Dayana», «ya le aviso», «déjame consultarlo con
 * Dayana»: una promesa de que Dayana se entera. Si la IA no escaló, el código
 * le avisa igual (Ricky, 17-oct: «Le paso tu mensaje a Dayana para que lo
 * revise» y Dayana nunca recibió nada).
 */
const HANDOFF =
  /\b(le (paso|comento|aviso|cuento|consulto|transmito|hago llegar|dejo) (tu|su|el|este|esto|a dayana)|ya le (aviso|paso|comento)|dejame (consultarlo|avisarle|preguntarle|confirmarlo|comentarselo|pasarle)|dayana (te|le) (confirma|escribe|responde|contesta|contactara|contacta|avisara|dira)|dayana se (pondra|pone) en contacto|te contactara|te (escribira|confirmara) dayana)/;
export const promisesHandoff = (text: string): boolean => HANDOFF.test(foldForSearch(text));

/**
 * Consejos de emergencia que la asistente nunca da (dueña, 24-oct: «es para
 * ventas y cierres»; Francy recibió «llama a la línea de emergencias de tu
 * país» porque la llamada «se cortó»): línea de emergencias, de prevención o de
 * crisis, urgencias, «llama al 123», «busca ayuda profesional inmediata». Si el
 * modelo lo escribe por su cuenta, sale la frase de apoyo y el siguiente paso.
 */
const EMERGENCY_ADVICE = new RegExp(
  [
    // No «la línea de atención de tu banco» ni «tuviste una emergencia, ¿reagendamos?».
    "lineas?\\s+(de\\s+)?(emergencias?|prevencion|crisis)",
    "lineas?\\s+de\\s+(ayuda|apoyo|atencion)\\s+(emocional|psicologica|en\\s+salud\\s+mental)",
    "(servicios?|numeros?|telefonos?)\\s+de\\s+(emergencias?|urgencias)",
    "\\burgencias\\b",
    "llam(a|ar|es)\\s+al\\s+\\d{3}\\b",
    "(busca|buscar|busques|pide|pedir|pidas|acude|acudir|acudas)\\s+(a\\s+)?(ayuda|atencion|apoyo)\\s+(profesional|medica|psicologica|psiquiatrica|inmediata|urgente|ya|ahora)",
  ].join("|")
);
export const givesEmergencyAdvice = (text: string | null | undefined): boolean => Boolean(text) && EMERGENCY_ADVICE.test(foldForSearch(text!));

/**
 * Ya saludó: no vuelve a saludar (Malka, 28-oct: «Buenas noches, Malka. Te bendigo.
 * ¿Cómo estás?» y un minuto después «Hola Malka, te bendigo. Claro que sí…»). Si un
 * mensaje de la asistente (no un envío automático) de las últimas 12 h empezaba con un
 * saludo, se quita el saludo del comienzo de la respuesta («Buenas noches.», «Hola Malka,
 * te bendigo.»). Solo si queda algo que decir.
 */
const OPENING =
  /^\s*(?:¡?hola(?:\s+[a-záéíóúñ]+)?\s*[,.!]|buen(?:os|as)\s+(?:d[ií]as|tardes|noches)(?:\s*,?\s*[a-záéíóúñ]+)?\s*[,.!]|te bendigo\s*[,.!])\s*(?:te bendigo\s*[,.!💛🙏]*\s*)?/i;
const GREETS = /^\s*(¡?hola\b|te bendigo\b|buen(os|as) (d[ií]as|tardes|noches)\b)/i;
export const withoutRepeatedGreeting = (
  text: string,
  lines: { direction: string; body: string | null; isAutoReply?: boolean | null; sentAt?: Date | null; source?: string | null; clientKey?: string | null }[],
  now: number
): string => {
  const greeted = lines.some(
    (l) =>
      l.direction === "OUTBOUND" &&
      Boolean(l.isAutoReply) &&
      !isAutoSend(l) &&
      GREETS.test(l.body ?? "") &&
      (!l.sentAt || now - l.sentAt.getTime() < 12 * 3600_000)
  );
  if (!greeted) return text;
  const rest = text.replace(OPENING, "");
  if (rest === text || rest.trim().split(/\s+/).length < 3) return text;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
};

/**
 * El modelo escribió horas de la llamada por su cuenta, sin pedirlas a la agenda
 * (auditoría 13-nov: 19 de los 22 bloqueos «horas que no salieron de tu agenda»
 * no llamaron a `offer_free_call_slots`; el freno cambiaba la respuesta por
 * «Déjame revisar la agenda» y 6 nunca tuvieron respuesta). Una hora junto a
 * palabras de agenda o de la llamada, y no de un evento, un taller o una clase.
 */
const OWN_TIME = /\b(a las? \d{1,2}(:\d{2})?|\d{1,2}(:\d{2})?\s*(a\.?\s?m\b|p\.?\s?m\b|am\b|pm\b))/;
const AGENDA_WORDS = /\b(llamada|llamarte|te llama|espacio|espacios|horario|horarios|disponible|disponibles|agenda|agendar|agendo|cita)\b/;
const NOT_A_CALL = /\b(evento|webinar|taller|clase|clases|live|en vivo|curso|meet|sesion de hoy)\b/;
export const writesOwnHours = (text: string | null | undefined): boolean => {
  const t = foldForSearch(text ?? "");
  return OWN_TIME.test(t) && AGENDA_WORDS.test(t) && !NOT_A_CALL.test(t);
};

/** Lo que ella escribió va de agendar (un día, una hora, la llamada, o un «sí» a la invitación). */
const SCHEDULE_ASK =
  /\b(hora|horas|horario|horarios|cuando|dia|dias|agenda|agendar|agendame|llamada|cita|disponible|manana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo|tarde|noche|semana|si|ok|dale|claro|listo|bueno|perfecto|puedo)\b/;
export const asksAboutSchedule = (texts: (string | null | undefined)[]): boolean => texts.some((t) => SCHEDULE_ASK.test(foldForSearch(t ?? "")));

/**
 * Lo que el modelo deja entre corchetes como plantilla nunca sale (Estrella, 14-nov:
 * «Perfecto, [Estrella/nombre]. Ya sabemos que estás en Colombia…»). Un corchete con
 * el nombre («[nombre]», «[Estrella/nombre]», «[Nombre del cliente]») se cambia por el
 * nombre seguro o se quita con su coma; cualquier otro («[hora]», «[Enlace]») se quita.
 * Un enlace en Markdown («[texto](https://…)») no se toca.
 */
const PLACEHOLDER = /(\s*,)?\s*\[([^\][\n]{1,48})\](?!\()/g;
const NAME_SLOT = /\b(nombre|name|cliente|persona|usuari[oa])\b|\//;
export const withoutPlaceholders = (text: string, sureName: string | null): string => {
  if (!text.includes("[")) return text;
  // El nombre: por el seguro, o fuera con su coma.
  const named = text.replace(PLACEHOLDER, (m, comma: string | undefined, inner: string) =>
    NAME_SLOT.test(foldForSearch(inner)) ? (sureName ? `${comma ? "," : ""} ${sureName}` : "") : m
  );
  // Otro hueco («[hora]», «[día]»): la frase entera fuera (quedaría a medias), salvo
  // si lleva un enlace de verdad; ahí solo el hueco.
  const out = named
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?…])\s+/)
        .filter((sentence) => !PLACEHOLDER_ONLY.test(sentence) || /https?:\/\//.test(sentence))
        .map((sentence) => sentence.replace(PLACEHOLDER, ""))
        .join(" ")
    )
    .join("\n");
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?…:;])/g, "$1")
    .replace(/,([.!?…])/g, "$1")
    .replace(/(^|\n)[ \t]*[,.]\s*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};
const PLACEHOLDER_ONLY = /\[[^\][\n]{1,48}\](?!\()/;

/**
 * «Las 7:00 p. m. de Colombia son las 7:00 p. m. de Venezuela» (Manuel, 14-nov: son las
 * 8). Cuando el modelo convierte una hora de Colombia a la de la persona, la cuenta la
 * hace el código: `offsetMin` = minutos que su hora va por delante de la de Colombia.
 * Solo toca la segunda hora de esa frase; sin la zona de la persona no se toca nada.
 */
const HOUR = String.raw`(\d{1,2})(?::(\d{2}))?\s*(a|p)\.?\s*m\.?`;
const ZONE_CLAIM = new RegExp(
  String.raw`(las?\s+)${HOUR}(\s+(?:de|en|hora de)\s+colombia\s+(?:son|serian|serían|equivalen a|es)\s+(?:las?\s+)?)${HOUR}`,
  "gi"
);
const fmtHour = (min: number): string => {
  const m = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "a. m." : "p. m."}`;
};
const toMin = (h: string, mm: string | undefined, ap: string): number =>
  ((Number(h) % 12) + (ap.toLowerCase() === "p" ? 12 : 0)) * 60 + Number(mm ?? 0);
export const fixZoneClaims = (text: string, offsetMin: number | null): string => {
  if (offsetMin === null) return text;
  return text.replace(ZONE_CLAIM, (whole, pre: string, h1: string, m1: string | undefined, ap1: string, mid: string, h2: string, m2: string | undefined, ap2: string) => {
    const expected = toMin(h1, m1, ap1) + offsetMin;
    if (toMin(h2, m2, ap2) === ((expected % 1440) + 1440) % 1440) return whole;
    return `${pre}${fmtHour(toMin(h1, m1, ap1))}${mid}${fmtHour(expected)}`;
  });
};

/**
 * Pregunta qué días u horas hay (Manuel, 14-nov: «De que dia de la semana se puede»;
 * le contestaron «los días que prefieras, de lunes a sábado» sin horas reales).
 */
const ASKS_SLOTS =
  /\b(que|cuales?) (dias?|horas?|horarios?|espacios?|fechas?)\b|\b(de|a) que (dia|hora)\b|\bcuando (puede|me puede|me podria|podria|seria|es posible)\b|\b(tienes?|tiene|hay|habra) (espacio|cupo|disponib|para (hoy|manana|el))|\bpara cuando\b|\bque disponibilidad\b|\bhorarios? disponibles?\b/;
export const asksForSlots = (texts: (string | null | undefined)[]): boolean => texts.some((t) => ASKS_SLOTS.test(foldForSearch(t ?? "")));

/**
 * La respuesta del modelo le pregunta a la persona qué día u hora quiere en vez de darle
 * las horas libres (auditoría 14-nov: Manuel, Noé, Yaqueline, Silvia; cada vuelta de más
 * terminaba en horas que no eran las de la agenda o en la zona equivocada).
 */
const ASKS_WHEN = /(que|cual|en que) (dia|dias|hora|horario|franja|momento)[^?]{0,60}\?|\ba que hora\b[^?]{0,60}\?|\bcuando (te queda|te sirve|puedes|prefieres)\b|\bdime (que|cual|el) (dia|hora|horario)|\bcuentame (a que hora|que dia|que horario|cuando)/;
export const asksWhenInstead = (text: string | null | undefined): boolean => ASKS_WHEN.test(foldForSearch(text ?? ""));
