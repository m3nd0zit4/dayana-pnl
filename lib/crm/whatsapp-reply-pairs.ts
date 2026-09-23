/**
 * De una conversación, los pares «lo que escribió la persona → lo que
 * contestó Dayana». Son la materia prima de los ejemplos con los que la IA
 * aprende a escribir como ella.
 *
 * Puro (sin Prisma, sin red): lo usan tanto el servidor, al leer los hilos de
 * la bandeja, como el navegador, al leer un chat exportado de WhatsApp antes
 * de subirlo.
 */

export type PairInputMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string | null;
  sentAt: Date;
  /** Saliente escrito por una persona. Un saludo o una respuesta de la IA
   * no es un ejemplo de Dayana. */
  isHuman: boolean;
};

export type ReplyPair = {
  clientText: string;
  replyText: string;
  /**
   * Id del PRIMER mensaje de la respuesta: clave estable del ejemplo. Si Dayana
   * sigue escribiendo, el mismo ejemplo se amplía en vez de duplicarse.
   */
  replyKey: string;
  repliedAt: Date;
};

/** Una respuesta que llega dos días después ya no es respuesta a eso. */
const MAX_REPLY_DELAY_MS = 48 * 60 * 60 * 1000;
/** Varios mensajes seguidos de Dayana cuentan como una respuesta. */
const MAX_REPLY_GAP_MS = 30 * 60 * 1000;
const MAX_CLIENT_CHARS = 1200;
const MAX_REPLY_CHARS = 1500;

const clean = (value: string | null): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

/** Se queda con el final: lo último que dijo la persona es lo que se contesta. */
const tail = (text: string, max: number) =>
  text.length <= max ? text : `…${text.slice(text.length - max)}`;

const head = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max)}…`;

export const extractReplyPairs = (
  messages: PairInputMessage[]
): ReplyPair[] => {
  const sorted = [...messages].sort(
    (a, b) => a.sentAt.getTime() - b.sentAt.getTime()
  );
  const pairs: ReplyPair[] = [];

  let client: { texts: string[]; lastAt: Date } | null = null;
  let reply: { texts: string[]; lastAt: Date; firstId: string } | null = null;

  const flush = () => {
    if (client && reply) {
      const clientText = client.texts.join("\n");
      const replyText = reply.texts.join("\n");
      if (clientText && replyText) {
        pairs.push({
          clientText: tail(clientText, MAX_CLIENT_CHARS),
          replyText: head(replyText, MAX_REPLY_CHARS),
          replyKey: reply.firstId,
          repliedAt: reply.lastAt,
        });
      }
      client = null;
    }
    reply = null;
  };

  for (const message of sorted) {
    const text = clean(message.body);

    if (message.direction === "INBOUND") {
      if (reply) flush();
      if (!text) continue;
      if (!client) client = { texts: [], lastAt: message.sentAt };
      client.texts.push(text);
      client.lastAt = message.sentAt;
      continue;
    }

    // Saliente automático: esa pregunta ya la contestó la máquina.
    if (!message.isHuman) {
      flush();
      client = null;
      continue;
    }

    if (reply) {
      const gap = message.sentAt.getTime() - reply.lastAt.getTime();
      if (gap > MAX_REPLY_GAP_MS) {
        flush();
        continue;
      }
      if (text) reply.texts.push(text);
      reply.lastAt = message.sentAt;
      continue;
    }

    if (!client) continue;
    const delay = message.sentAt.getTime() - client.lastAt.getTime();
    if (delay > MAX_REPLY_DELAY_MS) {
      client = null;
      continue;
    }
    reply = {
      texts: text ? [text] : [],
      lastAt: message.sentAt,
      firstId: message.id,
    };
  }
  flush();

  return pairs;
};

// ── Chat exportado desde WhatsApp ──────────────────────────────────────────

export type ExportedMessage = {
  sender: string;
  text: string | null;
  at: Date;
};

export type ParsedExport = {
  messages: ExportedMessage[];
  /** Quién escribe y cuántos mensajes, para elegir cuál es Dayana. */
  senders: { name: string; count: number }[];
};

/**
 * Una línea que empieza mensaje, en los formatos de Android e iPhone:
 *   23/09/26, 14:05 - Nombre: texto
 *   23/9/2026 2:05 p. m. - Nombre: texto
 *   [23/09/26, 14:05:33] Nombre: texto
 */
const LINE =
  /^\[?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s*(?:m\.?)?\]?\s*(?:-\s*)?([^:]{1,80}?):\s?(.*)$/i;

/** Lo que WhatsApp pone en lugar de un adjunto o de un mensaje borrado. */
const PLACEHOLDER =
  /^(<[^>]*omitid[oa]>|<media omitted>|.*\bomitid[oa]$|se eliminó este mensaje\.?|este mensaje fue eliminado\.?|eliminaste este mensaje\.?|null)$/i;

const toDate = (
  d: number,
  m: number,
  y: number,
  h: number,
  min: number,
  s: number,
  ampm: string | undefined
): Date => {
  let day = d;
  let month = m;
  // Casi siempre día/mes; si el «mes» pasa de 12, el orden era mes/día.
  if (month > 12 && day <= 12) [day, month] = [month, day];
  const year = y < 100 ? 2000 + y : y;
  let hour = h;
  if (ampm) {
    const pm = ampm.toLowerCase() === "p";
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  return new Date(year, month - 1, day, hour, min, s);
};

export const parseWhatsAppExport = (raw: string): ParsedExport => {
  const messages: ExportedMessage[] = [];
  const lines = raw
    .replace(/\r\n?/g, "\n")
    // Marcas de dirección y espacios raros que mete el exportador.
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/[\u202f\u00a0]/g, " ")
    .split("\n");

  let current: ExportedMessage | null = null;
  for (const line of lines) {
    const match = LINE.exec(line.trim());
    if (match) {
      const [, d, m, y, h, min, s, ampm, sender, text] = match;
      current = {
        sender: sender.trim(),
        text: text.trim(),
        at: toDate(+d, +m, +y, +h, +min, s ? +s : 0, ampm),
      };
      messages.push(current);
      continue;
    }
    // Sin cabecera: continuación del mensaje anterior (saltos de línea).
    if (current && line.trim()) {
      current.text = `${current.text ?? ""}\n${line.trim()}`;
    }
  }

  for (const message of messages) {
    const text = message.text?.trim() ?? "";
    message.text = !text || PLACEHOLDER.test(text) ? null : text;
  }

  const counts = new Map<string, number>();
  for (const message of messages) {
    counts.set(message.sender, (counts.get(message.sender) ?? 0) + 1);
  }

  return {
    messages,
    senders: [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };
};

/** Pares de un chat exportado, sabiendo cuál de los que escriben es Dayana. */
export const pairsFromExport = (
  messages: ExportedMessage[],
  ownerName: string
): ReplyPair[] =>
  extractReplyPairs(
    messages.map((message, index) => ({
      id: `export-${index}`,
      direction: message.sender === ownerName ? "OUTBOUND" : "INBOUND",
      body: message.text,
      sentAt: message.at,
      isHuman: true,
    }))
  );
