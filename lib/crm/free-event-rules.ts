import type { FreeEventStatus } from "@prisma/client";
import { FREE_EVENT_PATH } from "./free-webinar-publish";
import { slugify } from "./slug";

/**
 * Reglas puras de los eventos gratuitos como ediciones (igual que los
 * talleres). Sin base de datos: las usan el panel, la web, el reloj, el agente
 * y las pruebas.
 */

/**
 * Alias público del evento actual. Antes era el slug de la única fila; ahora
 * `/eventos-gratuitos/gratuito` y el código que todavía lo nombra resuelven al
 * evento abierto. Nunca se le da a un evento nuevo ni se guarda como URL vieja
 * de nadie: siempre significa «el de ahora».
 */
export const FREE_EVENT_ALIAS_SLUG = "gratuito";

export const FREE_EVENT_STATUS_LABEL: Record<FreeEventStatus, string> = {
  DRAFT: "Borrador",
  OPEN: "Publicado",
  CLOSED: "Inscripciones cerradas",
  COMPLETED: "Realizado",
};

/** Palabras cortas para chips en móvil. */
export const FREE_EVENT_STATUS_SHORT: Record<FreeEventStatus, string> = {
  DRAFT: "Borrador",
  OPEN: "Publicado",
  CLOSED: "Cerrado",
  COMPLETED: "Realizado",
};

/* -------------------------------------------------------------------------
 * URLs
 * ---------------------------------------------------------------------- */

const SLUG_TITLE_MAX = 40;

/**
 * «reprograma-tu-mente-con-pnl-2026-11-08». El titular se corta en una frontera
 * de palabra para que la fecha nunca quede mordida. Mismo criterio que la
 * migración que dio URL a las ediciones archivadas.
 */
export const freeEventSlugBase = (headline: string, dateKey: string | null): string => {
  let title = slugify(headline);
  if (title === "item") title = "";
  if (title.length > SLUG_TITLE_MAX) {
    const cut = title.slice(0, SLUG_TITLE_MAX + 1);
    const lastDash = cut.lastIndexOf("-");
    title = lastDash > 0 ? cut.slice(0, lastDash) : title.slice(0, SLUG_TITLE_MAX);
  }
  const parts = [title, dateKey].filter((p): p is string => Boolean(p));
  return parts.join("-") || "evento";
};

/** Candidatas en orden: la base, y luego -2, -3… */
export const freeEventSlugCandidates = function* (base: string): Generator<string> {
  yield base;
  for (let i = 2; i < 100; i += 1) yield `${base}-${i}`;
  yield `${base}-${Date.now()}`;
};

export const isReservedFreeEventSlug = (slug: string): boolean =>
  slug === FREE_EVENT_ALIAS_SLUG;

/** Dirección pública del evento actual. `/webinar-gratuito` redirige aquí. */
export const FREE_EVENT_PUBLIC_ROOT = FREE_EVENT_PATH;

/**
 * Página pública propia de un evento. La fila heredada que todavía se llama
 * `gratuito` usa su id: `gratuito` es el alias del evento actual.
 */
export const freeEventPublicPath = (e: { id: string; slug: string }): string =>
  `${FREE_EVENT_PUBLIC_ROOT}/${isReservedFreeEventSlug(e.slug) ? e.id : e.slug}`;

/* -------------------------------------------------------------------------
 * Estado
 * ---------------------------------------------------------------------- */

type StatusRow = {
  status: FreeEventStatus;
  isActive: boolean;
  startsAt: Date | null;
  endedAt: Date | null;
};

/** Abierto a inscripciones: publicado, con fecha y sin terminar. */
export const isFreeEventOpenRow = (e: StatusRow): boolean =>
  e.status === "OPEN" && e.startsAt != null && e.endedAt == null;

/**
 * Le tocan recordatorios y el enlace: publicado o con inscripciones cerradas,
 * sin terminar. `isActive` cubre filas creadas a mano (pruebas, la base de
 * antes) que todavía no tienen estado.
 */
export const freeEventAcceptsReminders = (e: StatusRow): boolean =>
  !isFreeEventEnded(e) && (e.status === "OPEN" || e.status === "CLOSED" || e.isActive);

/**
 * Ya pasó: terminado (a mano o por el reloj) o realizado. A un evento así no
 * se le cambia la fecha ni el enlace ni se le manda nada en masa: sus
 * inscritas y sus sellos son historia. Para otro evento, uno nuevo.
 */
export const isFreeEventEnded = (e: { status: FreeEventStatus; endedAt: Date | null }): boolean =>
  e.endedAt != null || e.status === "COMPLETED";

/** Lo que se le dice a quien intenta reprogramar uno ya pasado (panel y agente). */
export const ENDED_EVENT_MESSAGE =
  "Este evento ya pasó: no se le cambia la fecha ni el enlace. Crea uno nuevo o duplícalo en Eventos (/admin/eventos).";

/**
 * Lo que dice el agente cuando «el evento actual» ya pasó (por ejemplo, justo
 * después de un evento y antes de crear el siguiente): no lo toca.
 */
export const endedEventAgentMessage = (headline: string): string =>
  `El evento actual («${headline}») ya pasó, así que no lo modifico: sus inscritas y su historia se quedan como están. Para el próximo, crea uno con «Nuevo evento» (o «Duplicar» para copiar su página) en /admin/eventos; en cuanto exista, ese pasa a ser el actual y ya lo puedo editar.`;

/* -------------------------------------------------------------------------
 * Tope de confirmaciones por WhatsApp
 * ---------------------------------------------------------------------- */

/**
 * La confirmación al inscribirse sale de un formulario público y puede ser
 * una plantilla de pago: un tope por evento evita que un bot que rellena el
 * formulario con números cualquiera la convierta en un gasto. Pasado el tope
 * sigue llegando el correo; solo se salta el WhatsApp.
 */
export const EVENT_CONFIRMATION_CAP = { perHour: 40, perDay: 300 } as const;

export const confirmationCapReason = (
  sent: { lastHour: number; lastDay: number },
  cap: { perHour: number; perDay: number } = EVENT_CONFIRMATION_CAP
): "hour" | "day" | null => {
  if (sent.lastHour >= cap.perHour) return "hour";
  if (sent.lastDay >= cap.perDay) return "day";
  return null;
};

/** `isActive` es el espejo de OPEN: quien escribe el estado escribe esto. */
export const isActiveFor = (status: FreeEventStatus): boolean => status === "OPEN";

/** Estado al apagar la página: el que estaba publicado cierra inscripciones. */
export const statusAfterUnpublish = (status: FreeEventStatus): FreeEventStatus =>
  status === "OPEN" ? "CLOSED" : status;

/** Estado al reabrir uno terminado: sin inscripciones hasta volver a publicar. */
export const statusAfterReopen = (status: FreeEventStatus): FreeEventStatus =>
  status === "COMPLETED" ? "CLOSED" : status;

/* -------------------------------------------------------------------------
 * El evento actual
 * ---------------------------------------------------------------------- */

export type CurrentCandidate = {
  id: string;
  slug: string;
  status: FreeEventStatus;
  startsAt: Date | null;
  endedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
};

const rankOf = (e: CurrentCandidate): number => {
  if (e.endedAt) return 3;
  if (e.status === "OPEN") return 0;
  if (e.status === "CLOSED") return 1;
  if (e.status === "DRAFT") return 2;
  return 3;
};

/** Más reciente primero; sin fecha, al final. */
const desc = (a: Date | null, b: Date | null): number => {
  if (a && b) return b.getTime() - a.getTime();
  if (a) return -1;
  if (b) return 1;
  return 0;
};

/**
 * «El evento actual» para el panel, el agente y lo que todavía no sabe de
 * ediciones. En orden:
 *
 * 1. El publicado (si hubiera más de uno —publicar los cierra—, el de fecha
 *    más tardía).
 * 2. Uno con inscripciones cerradas que aún no pasó: el evento sigue en pie.
 * 3. El borrador más reciente: el que se está preparando.
 * 4. El último que se hizo.
 *
 * La fila heredada `gratuito` no necesita regla propia: la migración le dio
 * estado como a las demás, y a igualdad gana por ser la de siempre.
 */
export const pickCurrentFreeEvent = <T extends CurrentCandidate>(rows: T[]): T | null => {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const r = rankOf(a) - rankOf(b);
    if (r !== 0) return r;
    if (rankOf(a) === 2) {
      const c = desc(a.createdAt, b.createdAt);
      if (c !== 0) return c;
    } else {
      const s = desc(a.startsAt, b.startsAt);
      if (s !== 0) return s;
      const p = desc(a.publishedAt, b.publishedAt);
      if (p !== 0) return p;
    }
    const legacy = Number(b.slug === FREE_EVENT_ALIAS_SLUG) - Number(a.slug === FREE_EVENT_ALIAS_SLUG);
    if (legacy !== 0) return legacy;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return sorted[0] ?? null;
};

/**
 * El evento al que va una inscripción: el pedido si sigue abierto; si no, el
 * abierto de ahora (un formulario cacheado del evento anterior no debe
 * inscribir a nadie en algo que ya cerró).
 */
export const resolveRegistrationTarget = <T extends { id: string } & StatusRow>(
  requested: T | null,
  open: T | null
): T | null => (requested && isFreeEventOpenRow(requested) ? requested : open && isFreeEventOpenRow(open) ? open : null);

/* -------------------------------------------------------------------------
 * Historia
 * ---------------------------------------------------------------------- */

export type ActivityLike = {
  id: string;
  kind: string;
  at: Date;
  count: number | null;
  failed: number | null;
  staffUserId: string | null;
  whatsAppSendId: string | null;
  meta: unknown;
};

export type SendLike = {
  id: string;
  title: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  createdAt: Date;
  finishedAt: Date | null;
};

export type TimelineItem = {
  key: string;
  kind: string;
  at: Date;
  /** Si se juntaron varias pasadas, la última. */
  until: Date | null;
  /** Cuántas pasadas se juntaron. */
  runs: number;
  title: string;
  detail: string | null;
  count: number | null;
  failed: number | null;
  sendId: string | null;
  approximate: boolean;
  tone: "default" | "success" | "warning" | "muted";
};

const ACTIVITY_TITLE: Record<string, string> = {
  created: "Evento creado",
  published: "Publicado",
  unpublished: "Inscripciones cerradas",
  closed: "Inscripciones cerradas: se publicó otro evento",
  ended: "Evento terminado",
  reopened: "Reabierto",
  archived: "Archivado (sistema anterior)",
  meet_link_set: "Enlace de la reunión puesto",
  meet_link_changed: "Enlace de la reunión cambiado",
  date_changed: "Fecha cambiada",
  link_emails: "Correo con el enlace",
  reminder_24h_email: "Recordatorio de 24 h por correo",
  reminder_1h_email: "Recordatorio de 1 h por correo",
  reminder_24h_wa: "Recordatorio de 24 h por WhatsApp",
  reminder_1h_wa: "Recordatorio de 1 h por WhatsApp",
  material_uploaded: "Material subido",
  material_sent: "Material o grabación por WhatsApp",
  recording_sent: "Grabación por WhatsApp",
  whatsapp_bulk: "Envío por WhatsApp",
};

/** Pasadas que se repiten (cada tick del reloj): se juntan si van seguidas. */
const AGGREGATED = new Set([
  "link_emails",
  "reminder_24h_email",
  "reminder_1h_email",
  "reminder_24h_wa",
  "reminder_1h_wa",
]);

/** A igual hora, el orden natural de la historia. */
const KIND_ORDER = [
  "created",
  "published",
  "meet_link_set",
  "meet_link_changed",
  "date_changed",
  "closed",
  "unpublished",
  "ended",
  "archived",
];
const kindOrder = (kind: string) => {
  const i = KIND_ORDER.indexOf(kind);
  return i === -1 ? KIND_ORDER.length : i;
};

const metaOf = (meta: unknown): Record<string, unknown> =>
  meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};

const activityDetail = (a: ActivityLike): string | null => {
  const m = metaOf(a.meta);
  const parts: string[] = [];
  if (a.kind === "created" && typeof m.copiedFromHeadline === "string") {
    parts.push(`Con la página de «${m.copiedFromHeadline}»`);
  }
  if (a.kind === "closed" && typeof m.byHeadline === "string") parts.push(`Se publicó «${m.byHeadline}»`);
  if (a.kind === "ended") parts.push(m.by === "cron" ? "Lo cerró el reloj al pasar la fecha" : "Terminado a mano");
  if (a.kind === "date_changed" && typeof m.label === "string") parts.push(`Nueva fecha: ${m.label}`);
  if (a.kind === "material_uploaded" && typeof m.fileName === "string") parts.push(m.fileName);
  if (m.manual === true) parts.push("Enviado a mano");
  return parts.length ? parts.join(" · ") : null;
};

const toneFor = (kind: string, failed: number | null): TimelineItem["tone"] => {
  if (failed && failed > 0) return "warning";
  if (kind === "published" || kind === "ended") return "success";
  if (kind === "closed" || kind === "unpublished" || kind === "archived") return "muted";
  return "default";
};

/** «Evento: X · Recordatorio con el enlace de Meet» → «Recordatorio con el enlace de Meet». */
export const sendLabel = (title: string): string => {
  const at = title.lastIndexOf(" · ");
  return at >= 0 ? title.slice(at + 3).trim() || title : title;
};

/**
 * La historia de un evento: su actividad más sus envíos de WhatsApp, en orden.
 * Un envío registrado también como actividad sale una sola vez, con sus
 * números en vivo (los de la fila del envío, que avanzan por tandas). Las
 * pasadas del reloj que van seguidas se juntan en una sola línea con el total.
 * Devuelve de la más reciente a la más antigua.
 */
export const buildFreeEventTimeline = (input: {
  activities: ActivityLike[];
  sends: SendLike[];
}): TimelineItem[] => {
  const sendIds = new Set(input.sends.map((s) => s.id));
  const items: TimelineItem[] = [];

  for (const a of input.activities) {
    if (a.whatsAppSendId && sendIds.has(a.whatsAppSendId)) continue;
    const m = metaOf(a.meta);
    items.push({
      key: `a:${a.id}`,
      kind: a.kind,
      at: a.at,
      until: null,
      runs: 1,
      title: ACTIVITY_TITLE[a.kind] ?? a.kind,
      detail: activityDetail(a),
      count: a.count,
      failed: a.failed,
      sendId: a.whatsAppSendId,
      approximate: m.approximate === true,
      tone: toneFor(a.kind, a.failed),
    });
  }

  const materialKinds = new Map(
    input.activities
      .filter((a) => a.whatsAppSendId && sendIds.has(a.whatsAppSendId))
      .map((a) => [a.whatsAppSendId as string, a.kind])
  );
  for (const s of input.sends) {
    const linkedKind = materialKinds.get(s.id);
    const pending = Math.max(0, s.total - s.sent - s.failed - s.skipped);
    const detail = [
      `${s.total.toLocaleString("es-CO")} ${s.total === 1 ? "persona" : "personas"}`,
      s.skipped ? `${s.skipped.toLocaleString("es-CO")} sin poder enviar` : null,
      s.status === "CANCELLED" ? "cancelado" : pending > 0 && s.status !== "DONE" ? `${pending} en cola` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    items.push({
      key: `s:${s.id}`,
      kind: linkedKind ?? "whatsapp_send",
      at: s.createdAt,
      until: null,
      runs: 1,
      title: `WhatsApp: ${sendLabel(s.title)}`,
      detail,
      count: s.sent,
      failed: s.failed,
      sendId: s.id,
      approximate: false,
      tone: toneFor("whatsapp_send", s.failed),
    });
  }

  items.sort((x, y) => x.at.getTime() - y.at.getTime() || kindOrder(x.kind) - kindOrder(y.kind));

  const merged: TimelineItem[] = [];
  for (const item of items) {
    const prev = merged[merged.length - 1];
    if (prev && AGGREGATED.has(item.kind) && prev.kind === item.kind) {
      prev.until = item.at;
      prev.runs += 1;
      prev.count = (prev.count ?? 0) + (item.count ?? 0);
      prev.failed = (prev.failed ?? 0) + (item.failed ?? 0) || null;
      prev.tone = toneFor(prev.kind, prev.failed);
      if (item.detail && !prev.detail?.includes(item.detail)) {
        prev.detail = [prev.detail, item.detail].filter(Boolean).join(" · ");
      }
      continue;
    }
    merged.push({ ...item });
  }
  return merged.reverse();
};

/* -------------------------------------------------------------------------
 * Inscripciones por día y sellos
 * ---------------------------------------------------------------------- */

const dayKey = (d: Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const nextDay = (key: string): string => {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
};

/**
 * Inscripciones por día en la zona del CRM, con los días sin nadie en cero
 * (si no, la gráfica junta días que no son contiguos). Más de `maxDays` días
 * se recortan a los últimos.
 */
export const registrationsPerDay = (
  dates: Date[],
  timeZone: string,
  maxDays = 60
): { day: string; count: number }[] => {
  if (dates.length === 0) return [];
  const counts = new Map<string, number>();
  for (const d of dates) {
    const k = dayKey(d, timeZone);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const keys = [...counts.keys()].sort();
  const out: { day: string; count: number }[] = [];
  for (let k = keys[0]; k <= keys[keys.length - 1]; k = nextDay(k)) {
    out.push({ day: k, count: counts.get(k) ?? 0 });
    if (out.length > 3660) break;
  }
  return out.slice(-maxDays);
};

export type FlagSummary = { count: number; first: Date | null; last: Date | null };

/** Cuántos sellos y entre qué fechas: «24 h por correo: 120, del 3 al 4 oct». */
export const summarizeFlag = (dates: (Date | null | undefined)[]): FlagSummary => {
  let count = 0;
  let first: Date | null = null;
  let last: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    count += 1;
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
  }
  return { count, first, last };
};
