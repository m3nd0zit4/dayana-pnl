/**
 * «Te toca» en los chats de WhatsApp, en reglas puras (sin base de datos): las
 * usan el servidor, la pantalla y las pruebas.
 *
 * Un chat entra en «Te toca» solo cuando de verdad necesita a Dayana: la IA se
 * lo pasó (no sabe, un pago, quiere agendar, algo delicado), nadie va a
 * contestar un mensaje que no es un simple «gracias», o hay algo esperando su
 * autorización. Sale en cuanto ella contesta —desde el CRM o desde el
 * celular— o pulsa «Listo». Un mensaje nuevo que importa lo vuelve a abrir.
 */

type When = Date | string | null | undefined;

const time = (v: When): number | null => {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * La persona escribió después de la última resolución. Ya no decide ninguna
 * cola: lo usa el historial importado para no dejar el pasado abierto.
 */
export const isPending = (c: { lastInboundAt: When; resolvedAt: When }): boolean => {
  const inbound = time(c.lastInboundAt);
  if (inbound === null) return false;
  const resolved = time(c.resolvedAt);
  return resolved === null || inbound > resolved;
};

/** Por qué quedó resuelto (`resolvedReason`): «Listo», una cita, un pago, el historial. */
export type ResolveReason = "manual" | "appointment" | "payment" | "import" | "backfill";

// ─── Quién contestó ─────────────────────────────────────────────────────────

/**
 * Quién contestó lo último del chat:
 * - `unanswered`: lo último es de la persona.
 * - `you`: Dayana, desde el CRM (o una propuesta de la IA que ella aprobó).
 * - `you_phone`: Dayana, desde la app del celular (eco de coexistencia).
 * - `ai`: la IA sola.
 * - `auto`: un envío automático que no es respuesta (recordatorio, masivo, saludo).
 */
export type ReplyState = "unanswered" | "you" | "you_phone" | "ai" | "auto";

export type ReplyMessage = {
  direction: string;
  isEcho: boolean;
  isAutoReply: boolean;
  source: string | null;
  kind: string;
  status?: string | null;
  clientKey?: string | null;
};

/** `source` de los envíos que no son una respuesta a la persona. */
const AUTO_SOURCES = ["bulk:", "recordatorio:", "evento:"];
/** Por la clave del envío: el saludo no lleva `source` (`welcome:<chat>`). */
const AUTO_CLIENT_KEYS = ["welcome:", "reminder:", "bulk:"];

const startsWithAny = (v: string | null | undefined, prefixes: string[]) =>
  Boolean(v) && prefixes.some((p) => v!.startsWith(p));

/** Un envío masivo (lo lanza Dayana, pero a muchas personas a la vez). */
export const isBulkSource = (source: string | null | undefined): boolean => Boolean(source?.startsWith("bulk:"));

/** Recordatorio, masivo, recordatorio del evento o saludo: sale solo, no contesta a nadie. */
export const isAutoSend = (s: { source?: string | null; clientKey?: string | null }): boolean =>
  startsWithAny(s.source, AUTO_SOURCES) || startsWithAny(s.clientKey, AUTO_CLIENT_KEYS);

/**
 * Mensajes del más nuevo al más viejo. Los avisos grises (`system`) y lo que
 * WhatsApp no entregó no cuentan como respuesta. `null` si no hay nada.
 */
export const replyStateOf = (messages: ReplyMessage[]): ReplyState | null => {
  for (const m of messages) {
    if (m.kind === "system") continue;
    if (m.direction === "INBOUND") return "unanswered";
    if (m.status === "FAILED") continue;
    if (m.isEcho) return "you_phone";
    if (isAutoSend(m)) return "auto";
    // Una propuesta de la IA que Dayana aceptó la envió ella.
    if (m.source === "approval") return "you";
    if (m.isAutoReply) return "ai";
    return "you";
  }
  return null;
};

/**
 * ¿Este envío lo hizo una persona contestando? Desde el CRM (con su usuario,
 * escrito por ella) o aprobando una propuesta de la IA. La IA sola, el saludo,
 * los recordatorios y los masivos no: nadie miró ese chat.
 */
export const isHumanSend = (s: {
  staffUserId?: string | null;
  isAutoReply?: boolean | null;
  source?: string | null;
  clientKey?: string | null;
}): boolean => {
  if (isAutoSend(s)) return false;
  if (s.source === "approval") return true;
  return Boolean(s.staffUserId) && !s.isAutoReply;
};

/** Un envío humano deja el chat leído y consume el borrador (el mismo criterio). */
export const sendClearsUnread = isHumanSend;

// ─── Mensajes que no piden respuesta ────────────────────────────────────────

const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{1F1E6}-\u{1F1FF}‍️⃣]/gu;

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** «graciaaas» → «gracias», «okkk» → «ok» (se aplica igual al vocabulario). */
const squeeze = (w: string) => w.replace(/(.)\1+/g, "$1");

/** Lo que hace que un mensaje sea un agradecimiento o un «ok». */
const CORE = new Set(
  [
    "gracias", "grax", "grasias", "gracia", "thanks",
    "ok", "okay", "okey", "oki", "okis",
    "listo", "lista",
    "amen", "bendiciones", "bendicion", "bendigo", "bendiga",
    "igualmente",
  ].map(squeeze)
);
/** Lo que puede acompañarlo sin cambiar nada («muchas», «a ti», «que Dios te…»). */
const FILLER = new Set(
  [
    "muchas", "muchisimas", "mil", "muy", "super",
    "te", "a", "ti", "para", "usted", "tambien", "y", "que", "la", "le", "lo", "mi",
    "dios", "dayana", "doctora", "doc", "hermosa", "bella", "linda", "querida", "amiga",
  ].map(squeeze)
);

export type TrivialInput = {
  body?: string | null;
  kind?: string | null;
  attachments?: unknown;
};

const attachmentKinds = (attachments: unknown): string[] =>
  Array.isArray(attachments) ? attachments.map((a) => String((a as { kind?: string } | null)?.kind ?? "")) : [];

/**
 * ¿Un mensaje que no pide respuesta? «gracias», «muchas gracias 🙏», «ok»,
 * «listo», «amén», «bendiciones», «te bendigo», «igualmente», solo emojis, un
 * sticker, una reacción. Una pregunta, una foto, un audio o un documento
 * (puede ser el comprobante de un pago) nunca lo son.
 */
export const isTrivialMessage = (m: TrivialInput): boolean => {
  if (m.kind === "system") return true;
  const kinds = attachmentKinds(m.attachments);
  if (kinds.some((k) => k !== "sticker")) return false;
  const text = (m.body ?? "").trim();
  if (/^(Reaccionó|Quitó una reacción)/.test(text)) return true;
  if (/[?¿]/.test(text) || text.length > 80) return false;
  const hadEmoji = text.replace(EMOJI, "") !== text;
  const words = fold(text)
    .replace(EMOJI, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(squeeze);
  if (words.length === 0) return hadEmoji || kinds.length > 0;
  if (words.length > 8) return false;
  return words.every((w) => CORE.has(w) || FILLER.has(w)) && words.some((w) => CORE.has(w));
};

export type BurstMessage = ReplyMessage & TrivialInput & { sentAt?: Date | null };

/**
 * Lo que la persona escribió desde la última respuesta (de Dayana o de la IA),
 * del más nuevo al más viejo. Los envíos automáticos, los avisos grises y lo
 * que no se entregó no cortan la ráfaga.
 */
export const inboundSinceLastReply = <T extends BurstMessage>(messagesNewestFirst: T[]): T[] => {
  const out: T[] = [];
  for (const m of messagesNewestFirst) {
    if (m.kind === "system") continue;
    if (m.direction === "INBOUND") {
      out.push(m);
      continue;
    }
    if (m.status === "FAILED" || isAutoSend(m)) continue;
    break;
  }
  return out;
};

/** ¿Algo de la ráfaga necesita respuesta? (vacía: no). */
export const needsReply = (burst: TrivialInput[]): boolean => burst.some((m) => !isTrivialMessage(m));

/** El primer mensaje de la ráfaga que pide respuesta (desde ahí «te toca»). */
export const firstNeedingReply = (burst: (TrivialInput & { sentAt?: Date | null })[]): Date | null => {
  let first: number | null = null;
  for (const m of burst) {
    if (isTrivialMessage(m) || !m.sentAt) continue;
    const t = m.sentAt.getTime();
    if (first === null || t < first) first = t;
  }
  return first === null ? null : new Date(first);
};

// ─── «Te toca» ──────────────────────────────────────────────────────────────

/**
 * Por qué le toca: `unanswered` (nadie va a contestar un mensaje que importa)
 * o la categoría de la escalada de la IA (`payment`, `booking`, `clinical`…).
 */
export type AttentionReason =
  | "unanswered"
  | "payment"
  | "unknown"
  | "complaint"
  | "clinical"
  | "reschedule"
  | "booking"
  | "other"
  | "error";

/**
 * Motivos por los que la IA no contesta y nadie más lo hará: si el mensaje
 * importa, «te toca». No abren: un contacto de la libreta (familia), nada
 * nuevo que contestar, o que Dayana ya contestó mientras la IA esperaba.
 */
const OPENS_ATTENTION = new Set([
  "manual",
  "favorite",
  "disabled",
  "owner_hours",
  "customer",
  "paused",
  "human_replied",
  "assigned",
  "no_model_key",
]);

export const opensAttention = (skipReason: string | null | undefined): boolean =>
  Boolean(skipReason && OPENS_ATTENTION.has(skipReason));

/**
 * Abrir «te toca» sobre lo que ya hay: se queda la fecha más vieja (desde
 * cuándo espera) y el motivo más concreto (una escalada pisa «sin responder»,
 * nunca al revés). `null` si no cambia nada.
 */
export const mergeAttention = (
  current: { at: When; reason: string | null },
  next: { at: Date; reason: string }
): { at: Date; reason: string } | null => {
  const was = time(current.at);
  if (was === null) return { at: next.at, reason: next.reason };
  const at = new Date(Math.min(was, next.at.getTime()));
  const reason = next.reason !== "unanswered" ? next.reason : (current.reason ?? next.reason);
  if (at.getTime() === was && reason === current.reason) return null;
  return { at, reason };
};

/**
 * ¿Una respuesta (o «Listo», una cita, un pago) en `upTo` cierra lo abierto
 * en `attentionAt`? Solo si es posterior: un eco que llega tarde pero se
 * escribió antes del mensaje de la persona no la cierra.
 */
export const closesAttention = (attentionAt: When, upTo: Date): boolean => {
  const at = time(attentionAt);
  return at !== null && at <= upTo.getTime();
};

/** ¿Dayana contestó después del mensaje que la IA está atendiendo? */
export const repliedSince = (lastHumanReplyAt: When, since: When): boolean => {
  const reply = time(lastHumanReplyAt);
  const from = time(since);
  return reply !== null && from !== null && reply >= from;
};

// ─── «Seguimiento» ──────────────────────────────────────────────────────────

/** Quietos al menos esto para pasar a «Seguimiento». */
export const SEGUIMIENTO_QUIET_HOURS = 48;
/** Y no más viejos que esto: lo anterior es archivo, no seguimiento. */
export const SEGUIMIENTO_WINDOW_DAYS = 30;

// ─── Citas ──────────────────────────────────────────────────────────────────

/**
 * ¿Esta pasada por el calendario acaba de dejarle una cita a la persona? Solo
 * en el cambio (cita nueva con número o contacto, número recién puesto, cita
 * que vuelve tras cancelarse, o cambio de hora), y solo si es futura.
 */
export const appointmentJustLinked = (input: {
  before: { phone: string | null; status: string; startsAt: Date } | null;
  phone: string | null;
  contactId: string | null;
  startsAt: Date;
  now: Date;
}): boolean => {
  if (input.startsAt.getTime() <= input.now.getTime()) return false;
  if (!input.phone && !input.contactId) return false;
  const b = input.before;
  if (!b) return true;
  return (
    (!b.phone && Boolean(input.phone)) ||
    b.status !== "active" ||
    b.startsAt.getTime() !== input.startsAt.getTime()
  );
};

/**
 * Hasta qué mensaje de la persona cubre una cita del calendario: lo que
 * escribió antes de que Dayana creara o moviera el evento (`updated` de
 * Google); sin ese dato, hasta ahora.
 */
export const appointmentCoversUntil = (eventUpdated: string | null | undefined, now: Date): Date => {
  const t = eventUpdated ? new Date(eventUpdated).getTime() : NaN;
  return Number.isNaN(t) || t > now.getTime() ? now : new Date(t);
};

/**
 * El último mensaje de la persona que la IA tuvo delante (su conversación se
 * carga antes de pensar). Lo que llegue después no lo leyó nadie: no puede
 * quedar como atendido por algo que la IA hizo. Sin fechas, el inicio de la vuelta.
 */
export const lastInboundSeen = (
  transcript: { direction: string; sentAt?: Date | null }[],
  fallback: Date
): Date => {
  let newest: number | null = null;
  for (const m of transcript) {
    if (m.direction !== "INBOUND" || !m.sentAt) continue;
    const t = m.sentAt.getTime();
    if (!Number.isNaN(t) && (newest === null || t > newest)) newest = t;
  }
  return newest === null ? fallback : new Date(newest);
};
