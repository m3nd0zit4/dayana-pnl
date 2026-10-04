import { Prisma, type FreeEventStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { listFreeEventActivities } from "./free-event-activity";
import {
  FREE_EVENT_STATUS_LABEL,
  buildFreeEventTimeline,
  freeEventPublicPath,
  pickCurrentFreeEvent,
  registrationsPerDay,
  summarizeFlag,
  type FlagSummary,
  type TimelineItem,
} from "./free-event-rules";

export { FREE_EVENT_STATUS_LABEL } from "./free-event-rules";

/**
 * Consultas de solo lectura para la sección «Eventos» del CRM: la lista de
 * eventos (como la de talleres), su historia y las personas que se
 * inscribieron. La escritura vive en `free-webinar.ts`.
 */

type GateInput = {
  status: FreeEventStatus;
  isActive: boolean;
  endedAt: Date | null;
};

/**
 * Le toca recordatorio y enlace: publicado o con inscripciones cerradas, sin
 * terminar. Despublicar para cerrar inscripciones no cancela el evento.
 */
export const isFreeEventUpcoming = (e: GateInput) =>
  e.endedAt == null && (e.status === "OPEN" || e.status === "CLOSED" || e.isActive);

/** Abierto a inscripciones — el mismo criterio que `/api/leads`. */
export const isFreeEventOpen = (e: GateInput) => e.endedAt == null && e.status === "OPEN";

/**
 * `/api/webinar/material?evento=<id>` lo sirve ahora mismo: evento en pie, con
 * fecha y con archivo. Uno ya realizado conserva sus columnas, pero su
 * material ya no se descarga por la web — mandar ese enlace sería un 404.
 */
export const isFreeEventMaterialDownloadable = (
  row: GateInput & { startsAt: Date | null; materialUrl: string | null }
) => isFreeEventUpcoming(row) && row.startsAt != null && row.materialUrl != null;

export type FreeEventStats = {
  registrations: number;
  linkSent: number;
  reminder24h: number;
  reminder1h: number;
  wa24h: number;
  wa1h: number;
  waConfirmation: number;
};

const EMPTY_STATS: FreeEventStats = {
  registrations: 0,
  linkSent: 0,
  reminder24h: 0,
  reminder1h: 0,
  wa24h: 0,
  wa1h: 0,
  waConfirmation: 0,
};

/** Contadores de todos los eventos en una sola consulta agregada. */
const statsByEvent = async (): Promise<Map<string, FreeEventStats>> => {
  const rows = await prisma.$queryRaw<
    {
      webinar_id: string;
      total: number;
      link: number;
      r24: number;
      r1: number;
      wa24: number;
      wa1: number;
      conf: number;
    }[]
  >(Prisma.sql`
    SELECT webinar_id,
      count(*)::int AS total,
      count(link_email_sent_at)::int AS link,
      count(reminder_24h_sent_at)::int AS r24,
      count(reminder_1h_sent_at)::int AS r1,
      (count(*) FILTER (WHERE reminder_24h_wa_sent_at IS NOT NULL AND wa_reminder_error IS NULL))::int AS wa24,
      (count(*) FILTER (WHERE reminder_1h_wa_sent_at IS NOT NULL AND wa_reminder_error IS NULL))::int AS wa1,
      (count(*) FILTER (WHERE confirmation_wa_sent_at IS NOT NULL AND confirmation_wa_error IS NULL))::int AS conf
    FROM webinar_registrations
    GROUP BY webinar_id
  `);
  return new Map(
    rows.map((r) => [
      r.webinar_id,
      {
        registrations: r.total,
        linkSent: r.link,
        reminder24h: r.r24,
        reminder1h: r.r1,
        wa24h: r.wa24,
        wa1h: r.wa1,
        waConfirmation: r.conf,
      },
    ])
  );
};

export type FreeEventRow = {
  id: string;
  slug: string;
  publicPath: string;
  headline: string;
  eventLabel: string;
  startsAt: Date | null;
  startsAtHasTime: boolean;
  status: FreeEventStatus;
  /** El de `pickCurrentFreeEvent`: el que el agente y lo viejo llaman «el evento». */
  isCurrent: boolean;
  isActive: boolean;
  endedAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  /** Enlace de la reunión: el recordatorio lo prefiere a la landing. */
  meetUrl: string | null;
  materialDownloadable: boolean;
  registrations: number;
  stats: FreeEventStats;
};

/**
 * Todos los eventos, como la lista de talleres: el publicado primero, luego
 * los que vienen (borradores y cerrados) y al final los realizados, del más
 * reciente al más antiguo.
 */
export const listFreeEvents = async (): Promise<FreeEventRow[]> => {
  const [rows, stats] = await Promise.all([
    prisma.freeWebinar.findMany({
      orderBy: [{ startsAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      select: {
        id: true,
        slug: true,
        headline: true,
        eventLabel: true,
        status: true,
        isActive: true,
        startsAt: true,
        startsAtHasTime: true,
        endedAt: true,
        publishedAt: true,
        createdAt: true,
        meetUrl: true,
        materialUrl: true,
      },
    }),
    statsByEvent(),
  ]);
  const current = pickCurrentFreeEvent(rows);
  const order: Record<FreeEventStatus, number> = { OPEN: 0, CLOSED: 1, DRAFT: 2, COMPLETED: 3 };
  return rows
    .map((r) => {
      const s = stats.get(r.id) ?? EMPTY_STATS;
      return {
        id: r.id,
        slug: r.slug,
        publicPath: freeEventPublicPath(r),
        headline: r.headline,
        eventLabel: r.eventLabel,
        startsAt: r.startsAt,
        startsAtHasTime: r.startsAtHasTime,
        status: r.status,
        isCurrent: r.id === current?.id,
        isActive: r.isActive,
        endedAt: r.endedAt,
        publishedAt: r.publishedAt,
        createdAt: r.createdAt,
        meetUrl: r.meetUrl,
        materialDownloadable: isFreeEventMaterialDownloadable(r),
        registrations: s.registrations,
        stats: s,
      };
    })
    .sort((a, b) => {
      const st = order[a.status] - order[b.status];
      if (st !== 0) return st;
      // Los que vienen, el más próximo primero; los pasados, el más reciente.
      const at = a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const bt = b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
      if (a.status === "COMPLETED") return bt - at || b.createdAt.getTime() - a.createdAt.getTime();
      return at - bt || b.createdAt.getTime() - a.createdAt.getTime();
    });
};

/* -------------------------------------------------------------------------
 * Historia de un evento
 * ---------------------------------------------------------------------- */

export type FreeEventFlags = {
  link: FlagSummary;
  reminder24h: FlagSummary;
  reminder1h: FlagSummary;
  wa24h: FlagSummary;
  wa1h: FlagSummary;
  waConfirmation: FlagSummary;
  waErrors: number;
};

export type FreeEventTimeline = {
  items: TimelineItem[];
  perDay: { day: string; count: number }[];
  flags: FreeEventFlags;
  registrations: number;
};

/**
 * Lo que pasó con un evento: su actividad, sus envíos de WhatsApp, las
 * inscripciones por día y, por cada sello (enlace, recordatorios,
 * confirmación), cuántas lo tienen y entre qué fechas salió.
 */
export const getFreeEventTimeline = async (
  id: string,
  timeZone: string
): Promise<FreeEventTimeline> => {
  const [activities, sends, regs] = await Promise.all([
    listFreeEventActivities(id),
    prisma.whatsAppSend.findMany({
      where: { freeWebinarId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        status: true,
        total: true,
        sent: true,
        failed: true,
        skipped: true,
        createdAt: true,
        finishedAt: true,
      },
    }),
    prisma.webinarRegistration.findMany({
      where: { webinarId: id },
      select: {
        createdAt: true,
        linkEmailSentAt: true,
        reminder24hSentAt: true,
        reminder1hSentAt: true,
        reminder24hWaSentAt: true,
        reminder1hWaSentAt: true,
        waReminderError: true,
        confirmationWaSentAt: true,
        confirmationWaError: true,
      },
    }),
  ]);
  return {
    items: buildFreeEventTimeline({ activities, sends }),
    perDay: registrationsPerDay(
      regs.map((r) => r.createdAt),
      timeZone
    ),
    flags: {
      link: summarizeFlag(regs.map((r) => r.linkEmailSentAt)),
      reminder24h: summarizeFlag(regs.map((r) => r.reminder24hSentAt)),
      reminder1h: summarizeFlag(regs.map((r) => r.reminder1hSentAt)),
      wa24h: summarizeFlag(regs.map((r) => r.reminder24hWaSentAt)),
      wa1h: summarizeFlag(regs.map((r) => r.reminder1hWaSentAt)),
      waConfirmation: summarizeFlag(
        regs.map((r) => (r.confirmationWaError ? null : r.confirmationWaSentAt))
      ),
      waErrors: regs.filter((r) => r.waReminderError).length,
    },
    registrations: regs.length,
  };
};

/* -------------------------------------------------------------------------
 * Personas inscritas
 * ---------------------------------------------------------------------- */

export type FreeEventPerson = {
  contactId: string;
  name: string;
  email: string | null;
  phoneE164: string | null;
  /** Eventos a los que se inscribió, del más reciente al más antiguo. */
  events: { id: string; headline: string; startsAt: Date | null }[];
  lastRegisteredAt: Date;
};

export type FreeEventPeoplePage = {
  people: FreeEventPerson[];
  total: number;
  page: number;
  pageSize: number;
  /**
   * Todas las personas del filtro (evento y búsqueda), no solo esta página:
   * a quién va «enviar a todas». Así el número del botón es el de la lista.
   */
  contactIds: string[];
};

const fullName = (c: { firstName: string | null; lastName: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ") || "Sin nombre";

/**
 * Las personas que se han inscrito a eventos gratuitos, una fila por persona
 * aunque haya ido a varios. Con `eventId`, solo las de ese evento.
 *
 * Se agrupa en memoria: son cientos de inscripciones, no millones, y así una
 * persona sale una vez con todos sus eventos.
 */
export const listFreeEventPeople = async (input: {
  eventId?: string | null;
  q?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<FreeEventPeoplePage> => {
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 10), 200);
  const page = Math.max(input.page ?? 1, 1);
  const q = input.q?.trim();

  const contactFilter = q
    ? {
        OR: [
          { firstName: { contains: q, mode: "insensitive" as const } },
          { lastName: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { phoneE164: { contains: q.replace(/[^\d+]/g, "") || q } },
        ],
      }
    : {};

  // Con filtro por evento, primero quiénes fueron a ese; luego TODOS sus
  // eventos, para ver si es alguien que repite.
  const contactIds = input.eventId
    ? (
        await prisma.webinarRegistration.findMany({
          where: { webinarId: input.eventId },
          select: { contactId: true },
        })
      ).map((r) => r.contactId)
    : null;

  const registrations = await prisma.webinarRegistration.findMany({
    where: {
      ...(contactIds ? { contactId: { in: contactIds } } : {}),
      contact: contactFilter,
    },
    orderBy: { createdAt: "desc" },
    take: 20000,
    select: {
      createdAt: true,
      webinar: { select: { id: true, headline: true, startsAt: true } },
      contact: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneE164: true,
        },
      },
    },
  });

  const byContact = new Map<string, FreeEventPerson>();
  for (const r of registrations) {
    const existing = byContact.get(r.contact.id);
    if (existing) {
      existing.events.push(r.webinar);
      continue;
    }
    byContact.set(r.contact.id, {
      contactId: r.contact.id,
      name: fullName(r.contact),
      email: r.contact.email,
      phoneE164: r.contact.phoneE164,
      events: [r.webinar],
      lastRegisteredAt: r.createdAt,
    });
  }

  const people = [...byContact.values()];
  return {
    people: people.slice((page - 1) * pageSize, page * pageSize),
    total: people.length,
    page,
    pageSize,
    contactIds: people.map((p) => p.contactId),
  };
};

/** Las inscritas de un evento para la pestaña de WhatsApp (las más recientes). */
export const listFreeEventRegistrantsForWhatsApp = async (eventId: string, take = 100) =>
  (
    await prisma.webinarRegistration.findMany({
      where: { webinarId: eventId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        createdAt: true,
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phoneE164: true } },
      },
    })
  ).map((r) => ({
    contactId: r.contact.id,
    name: fullName(r.contact),
    email: r.contact.email,
    phoneE164: r.contact.phoneE164,
    registeredAt: r.createdAt,
  }));

/**
 * A quién invitar: aceptaron recibir novedades, tienen WhatsApp y todavía no
 * se inscribieron a este evento. Mismo criterio que la invitación de talleres.
 */
export const listFreeEventInviteContactIds = async (eventId: string): Promise<string[]> => {
  const registered = await prisma.webinarRegistration.findMany({
    where: { webinarId: eventId },
    select: { contactId: true },
  });
  const rows = await prisma.contact.findMany({
    where: {
      consentMarketingAt: { not: null },
      notifyWhatsapp: true,
      NOT: { phoneE164: { startsWith: "+nophone" } },
      id: { notIn: registered.map((r) => r.contactId) },
    },
    select: { id: true },
    take: 2000,
  });
  return rows.map((r) => r.id);
};

/** «16 de agosto de 2026, 9:30 a. m.», en la zona del CRM. */
export const eventDateLabel = (
  row: { startsAt: Date | null; startsAtHasTime: boolean },
  timeZone: string
): string => {
  if (!row.startsAt) return "Sin fecha";
  return row.startsAt.toLocaleString("es-CO", {
    timeZone,
    dateStyle: "long",
    ...(row.startsAtHasTime ? { timeStyle: "short" as const } : {}),
  });
};

/** Etiqueta de estado para un evento de la lista. */
export const freeEventStatusLabel = (status: FreeEventStatus): string => FREE_EVENT_STATUS_LABEL[status];
