import type { WorkshopEditionStatus } from "@prisma/client";
import { getDateKeyInTz, zonedDateTimeToUtc } from "@/lib/datetime/zoned-time";
import { parseWorkshopSchedule } from "@/lib/workshop-schedule";
import {
  buildFreeEventTimeline,
  type ActivityLike,
  type SendLike,
  type TimelineItem,
} from "./free-event-rules";

/**
 * Reglas puras del ciclo de un taller, el mismo que el de los eventos
 * gratuitos: borrador → publicado → inscripciones cerradas → realizado. Sin
 * base de datos: las usan el panel, el reloj, el agente y las pruebas.
 */

export const WORKSHOP_STATUS_LABEL: Record<WorkshopEditionStatus, string> = {
  DRAFT: "Borrador",
  OPEN: "Publicado",
  CLOSED: "Inscripciones cerradas",
  COMPLETED: "Realizado",
};

type StatusRow = { status: WorkshopEditionStatus; endedAt: Date | null };

/** Ya pasó: terminado (a mano o por el reloj) o realizado. */
export const isWorkshopEnded = (e: StatusRow): boolean => e.endedAt != null || e.status === "COMPLETED";

/**
 * Le tocan recordatorios: publicado o con inscripciones cerradas, sin
 * terminar. Cerrar inscripciones no cancela el taller: quien pagó sigue
 * recibiendo el enlace.
 */
export const workshopAcceptsReminders = (e: StatusRow): boolean =>
  !isWorkshopEnded(e) && (e.status === "OPEN" || e.status === "CLOSED");

/** Al cerrar inscripciones, el publicado pasa a cerrado. */
export const workshopStatusAfterUnpublish = (s: WorkshopEditionStatus): WorkshopEditionStatus =>
  s === "OPEN" ? "CLOSED" : s;

/** Reabrir uno terminado: sin ventas hasta volver a publicarlo. */
export const workshopStatusAfterReopen = (s: WorkshopEditionStatus): WorkshopEditionStatus =>
  s === "COMPLETED" ? "CLOSED" : s;

/* -------------------------------------------------------------------------
 * Publicar
 * ---------------------------------------------------------------------- */

export type WorkshopPublishBlocker = "title" | "description" | "startsAt" | "priceCop" | "pastDate";

export const WORKSHOP_PUBLISH_BLOCKER_LABELS: Record<WorkshopPublishBlocker, string> = {
  title: "el título",
  description: "la descripción",
  startsAt: "la fecha",
  priceCop: "el precio en pesos (COP)",
  pastDate: "una fecha que no haya pasado",
};

/** La descripción que sale en la tarjeta y en la página. */
export const workshopDescriptionOf = (e: {
  cardSummary?: string | null;
  detailSummary?: string | null;
  intro?: string | null;
}): string => e.cardSummary?.trim() || e.detailSummary?.trim() || e.intro?.trim() || "";

/* -------------------------------------------------------------------------
 * Fecha y cierre
 * ---------------------------------------------------------------------- */

type TimingRow = {
  startsAt: Date | null;
  /** Sin hora: `startsAt` es un ancla de mediodía, no una hora de verdad. */
  startsAtHasTime: boolean;
  endsAt?: Date | null;
  timezone: string;
  daySchedule?: unknown;
};

/**
 * ¿`startsAt` lleva hora de verdad? Lo guarda quien pone la fecha (como en
 * los eventos); no se deduce: un taller a mediodía es un taller a mediodía.
 */
export const workshopStartsAtHasTime = (e: Pick<TimingRow, "startsAt" | "startsAtHasTime">): boolean =>
  Boolean(e.startsAt) && e.startsAtHasTime;

/** Margen tras el inicio antes de darlo por realizado, como en los eventos. */
export const WORKSHOP_CLOSE_GRACE_MS = 3 * 60 * 60 * 1000;

/**
 * Cuándo el reloj da el taller por realizado: al terminar (`endsAt`), o 3 h
 * después de empezar — pero nunca antes de que acabe su cronograma: una
 * jornada de 7:30 a 16:30 no se cierra a las 10:30. Sin hora real, a las 03:00
 * del día siguiente.
 */
export const workshopCloseAt = (e: TimingRow): Date | null => {
  if (e.endsAt) return e.endsAt;
  if (!e.startsAt) return null;
  const dateKey = getDateKeyInTz(e.startsAt, e.timezone);
  if (!workshopStartsAtHasTime(e)) {
    return new Date(zonedDateTimeToUtc(dateKey, "00:00", e.timezone).getTime() + 27 * 60 * 60 * 1000);
  }
  let closeAt = e.startsAt.getTime() + WORKSHOP_CLOSE_GRACE_MS;
  const slots = parseWorkshopSchedule(e.daySchedule);
  const lastEnd = slots.map((s) => s.endTime).filter(Boolean).sort().pop();
  if (lastEnd) {
    try {
      const end = zonedDateTimeToUtc(dateKey, lastEnd, e.timezone).getTime();
      if (end > closeAt) closeAt = end;
    } catch {
      // Una hora mal escrita en el cronograma no bloquea el cierre.
    }
  }
  return new Date(closeAt);
};

/** Ya pasó su hora de cierre: publicarlo lo vendería después de hecho. */
export const isWorkshopDatePast = (e: TimingRow, now: Date = new Date()): boolean => {
  const closeAt = workshopCloseAt(e);
  return closeAt !== null && now.getTime() >= closeAt.getTime();
};

/* -------------------------------------------------------------------------
 * Publicar
 * ---------------------------------------------------------------------- */

/**
 * Lo que falta para publicar. El precio en pesos lo decide `canOpenWithPrice`
 * (el propio o, en una edición heredada, el del paquete compartido): aquí
 * llega ya resuelto. Una fecha que ya pasó también bloquea: se cambia antes.
 */
export const workshopPublishBlockers = (
  e: {
    title: string;
    cardSummary?: string | null;
    detailSummary?: string | null;
    intro?: string | null;
  } & TimingRow,
  hasCopPrice: boolean,
  now: Date = new Date()
): WorkshopPublishBlocker[] => {
  const out: WorkshopPublishBlocker[] = [];
  if (!e.title.trim()) out.push("title");
  // Sin descripción propia el enriquecido repite el título: no cuenta.
  const description = workshopDescriptionOf(e);
  if (!description || description === e.title.trim()) out.push("description");
  if (!e.startsAt) out.push("startsAt");
  else if (isWorkshopDatePast(e, now)) out.push("pastDate");
  if (!hasCopPrice) out.push("priceCop");
  return out;
};

export const PAST_DATE_MESSAGE = "La fecha ya pasó: cámbiala antes de publicar";

export const workshopBlockersMessage = (blockers: WorkshopPublishBlocker[]): string => {
  const missing = blockers.filter((b) => b !== "pastDate");
  const parts = [
    blockers.includes("pastDate") ? PAST_DATE_MESSAGE : null,
    missing.length ? `Falta ${missing.map((b) => WORKSHOP_PUBLISH_BLOCKER_LABELS[b]).join(", ")}` : null,
  ].filter(Boolean);
  return parts.join(". ");
};

/* -------------------------------------------------------------------------
 * La lista
 * ---------------------------------------------------------------------- */

/** «Pasados»: los realizados. El resto (borradores, publicado, cerrados) son «Próximos». */
export const isWorkshopPast = (e: StatusRow): boolean => isWorkshopEnded(e);

const LIST_ORDER: Record<WorkshopEditionStatus, number> = { OPEN: 0, CLOSED: 1, DRAFT: 2, COMPLETED: 3 };

/**
 * Como la lista de eventos: el publicado primero, luego los cerrados y los
 * borradores (el más próximo primero, sin fecha al final) y los realizados del
 * más reciente al más antiguo.
 */
export const sortWorkshopsForList = <
  T extends StatusRow & { startsAt: Date | null; createdAt: Date },
>(
  rows: T[]
): T[] =>
  [...rows].sort((a, b) => {
    const sa = isWorkshopEnded(a) ? 3 : LIST_ORDER[a.status];
    const sb = isWorkshopEnded(b) ? 3 : LIST_ORDER[b.status];
    if (sa !== sb) return sa - sb;
    const at = a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bt = b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (sa === 3) return bt - at || b.createdAt.getTime() - a.createdAt.getTime();
    return at - bt || b.createdAt.getTime() - a.createdAt.getTime();
  });

/* -------------------------------------------------------------------------
 * Compatibilidad: quien todavía pide un estado (el asistente)
 * ---------------------------------------------------------------------- */

/**
 * El paso del ciclo que corresponde a «déjalo en este estado». El panel ya no
 * escribe estados: usa los botones. El asistente sí los pide, y así lo hacen
 * con las mismas funciones (historia, cierre de los otros, producto).
 */
export type WorkshopLifecycleStep =
  | "publish"
  | "reopen_publish"
  | "unpublish"
  | "reopen"
  | "close_draft"
  | "end"
  | "to_draft";

export const lifecycleStepFor = (
  current: StatusRow,
  target: WorkshopEditionStatus
): WorkshopLifecycleStep | null => {
  const ended = isWorkshopEnded(current);
  switch (target) {
    case "OPEN":
      if (ended) return "reopen_publish";
      return current.status === "OPEN" ? null : "publish";
    case "CLOSED":
      if (ended) return "reopen";
      if (current.status === "OPEN") return "unpublish";
      return current.status === "DRAFT" ? "close_draft" : null;
    case "COMPLETED":
      return ended ? null : "end";
    case "DRAFT":
      return current.status === "DRAFT" && !ended ? null : "to_draft";
  }
};

/* -------------------------------------------------------------------------
 * Historia
 * ---------------------------------------------------------------------- */

export const WORKSHOP_ACTIVITY_TITLE: Record<string, string> = {
  created: "Taller creado",
  published: "Publicado",
  unpublished: "Inscripciones cerradas",
  closed: "Inscripciones cerradas: se publicó otro taller",
  ended: "Taller terminado",
  reopened: "Reabierto",
  back_to_draft: "Vuelto a borrador",
  date_changed: "Fecha cambiada",
  meeting_link_set: "Enlace de la reunión puesto",
  meeting_link_changed: "Enlace de la reunión cambiado",
  price_changed: "Precio cambiado",
  reminder_24h_email: "Recordatorio de 24 h por correo",
  reminder_1h_email: "Recordatorio de 1 h por correo",
  reminder_24h_wa: "Recordatorio de 24 h por WhatsApp",
  reminder_1h_wa: "Recordatorio de 1 h por WhatsApp",
  whatsapp_bulk: "Envío por WhatsApp",
};

const metaOf = (meta: unknown): Record<string, unknown> =>
  meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};

const pesos = (n: number) => `$ ${n.toLocaleString("es-CO")} COP`;
const dollars = (cents: number) => `US$${(cents / 100).toFixed(2)}`;

/** Detalles propios de los talleres; el resto, los de los eventos. */
const workshopActivityDetail = (a: ActivityLike): string | null | undefined => {
  const m = metaOf(a.meta);
  if (a.kind === "created" && typeof m.copiedFromTitle === "string") {
    return `Con la página de «${m.copiedFromTitle}»`;
  }
  if (a.kind === "closed" && typeof m.byTitle === "string") return `Se publicó «${m.byTitle}»`;
  if (a.kind === "price_changed") {
    const parts = [
      typeof m.cop === "number" ? pesos(m.cop) : null,
      typeof m.usd === "number" ? dollars(m.usd) : null,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  if (a.kind === "back_to_draft") return "Lo pidió el asistente";
  return undefined;
};

/** La historia de una edición: su actividad más sus envíos de WhatsApp. */
export const buildWorkshopTimeline = (input: {
  activities: ActivityLike[];
  sends: SendLike[];
}): TimelineItem[] =>
  buildFreeEventTimeline(input, { titles: WORKSHOP_ACTIVITY_TITLE, detail: workshopActivityDetail });
