/**
 * «Pendiente» en los chats de WhatsApp, en reglas puras (sin base de datos):
 * las usan el servidor, la pantalla y las pruebas.
 *
 * Un chat está pendiente desde que la persona escribe hasta que se resuelve:
 * a mano («Marcar como atendido») o solo, al agendarse / confirmarse una cita o
 * confirmarse un pago. Responder NO lo resuelve — Dayana contesta muchas veces
 * desde el celular y eso no significa que el asunto esté cerrado. Un mensaje
 * nuevo de la persona lo vuelve a abrir.
 */

type When = Date | string | null | undefined;

const time = (v: When): number | null => {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

/** La persona escribió y nadie lo dio por atendido después. */
export const isPending = (c: { lastInboundAt: When; resolvedAt: When }): boolean => {
  const inbound = time(c.lastInboundAt);
  if (inbound === null) return false;
  const resolved = time(c.resolvedAt);
  return resolved === null || inbound > resolved;
};

/** Por qué dejó de estar pendiente. */
export type ResolveReason = "manual" | "appointment" | "payment" | "import" | "backfill";

/** «Atendido · por cita»: lo que se ve en la cabecera y en la lista. */
export const RESOLVED_LABEL: Record<ResolveReason, string> = {
  manual: "a mano",
  appointment: "por cita",
  payment: "por pago",
  import: "historial importado",
  backfill: "antes de los pendientes",
};

export const resolvedLabel = (reason: string | null | undefined): string =>
  RESOLVED_LABEL[reason as ResolveReason] ?? "a mano";

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
    if (startsWithAny(m.source, AUTO_SOURCES) || startsWithAny(m.clientKey, AUTO_CLIENT_KEYS)) return "auto";
    // Una propuesta de la IA que Dayana aceptó la envió ella.
    if (m.source === "approval") return "you";
    if (m.isAutoReply) return "ai";
    return "you";
  }
  return null;
};

/**
 * ¿Esta pasada por el calendario acaba de dejarle una cita a la persona? Solo
 * en el cambio (cita nueva con número o contacto, número recién puesto, cita
 * que vuelve tras cancelarse, o cambio de hora), y solo si es futura: si la
 * persona escribe otra vez después, el chat vuelve a quedar pendiente y la
 * siguiente pasada no lo resuelve de nuevo.
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
 * ¿Un envío deja el chat «leído»? Solo cuando lo manda una persona desde el
 * CRM (o aprueba una propuesta): ahí Dayana vio el chat. La IA, el saludo, los
 * recordatorios y los envíos masivos no: nadie miró ese chat.
 */
export const sendClearsUnread = (s: {
  staffUserId?: string | null;
  isAutoReply?: boolean | null;
  source?: string | null;
}): boolean => {
  if (isBulkSource(s.source)) return false;
  if (s.source === "approval") return true;
  return Boolean(s.staffUserId) && !s.isAutoReply;
};
