import { prisma } from "@/lib/db";
import { FREE_WEBINAR_SLUG } from "./free-webinar";

/**
 * Consultas de solo lectura para la sección «Eventos gratuitos» del CRM:
 * el historial de todos los eventos y las personas que se inscribieron.
 *
 * Cada evento es una fila de `free_webinars`. La del slug `gratuito` es la
 * que se está preparando o la última que se hizo; las demás son ediciones
 * archivadas (`archiveFreeWebinar`). La escritura sigue viviendo en
 * `free-webinar.ts`; aquí solo se lee.
 */

export type FreeEventStatus = "draft" | "published" | "held" | "archived";

export const FREE_EVENT_STATUS_LABEL: Record<FreeEventStatus, string> = {
  draft: "En preparación",
  published: "Publicado",
  held: "Realizado",
  archived: "Archivado",
};

type StatusInput = {
  slug: string;
  isActive: boolean;
  startsAt: Date | null;
  endedAt: Date | null;
  archivedAt: Date | null;
};

/**
 * En qué punto está un evento. «Realizado» cubre también el evento cuya
 * fecha ya pasó aunque nadie lo haya cerrado a mano: para el historial, lo
 * que importa es que ya ocurrió.
 */
export const freeEventStatus = (
  row: StatusInput,
  now: Date = new Date()
): FreeEventStatus => {
  if (row.archivedAt || row.slug !== FREE_WEBINAR_SLUG) return "archived";
  if (row.endedAt || (row.startsAt && row.startsAt.getTime() < now.getTime())) {
    return "held";
  }
  return row.isActive ? "published" : "draft";
};

export type FreeEventRow = {
  id: string;
  headline: string;
  eventLabel: string;
  startsAt: Date | null;
  startsAtHasTime: boolean;
  status: FreeEventStatus;
  isCurrent: boolean;
  registrations: number;
};

/** Todos los eventos, del más reciente al más antiguo. */
export const listFreeEvents = async (): Promise<FreeEventRow[]> => {
  const rows = await prisma.freeWebinar.findMany({
    orderBy: [
      { startsAt: { sort: "desc", nulls: "first" } },
      { createdAt: "desc" },
    ],
    select: {
      id: true,
      slug: true,
      headline: true,
      eventLabel: true,
      isActive: true,
      startsAt: true,
      startsAtHasTime: true,
      endedAt: true,
      archivedAt: true,
      _count: { select: { registrations: true } },
    },
  });
  const now = new Date();
  return (
    rows
      // El evento en preparación sin fecha ni inscritas no es historia todavía.
      .filter(
        (r) =>
          r.slug !== FREE_WEBINAR_SLUG ||
          r.startsAt ||
          r._count.registrations > 0
      )
      .map((r) => ({
        id: r.id,
        headline: r.headline,
        eventLabel: r.eventLabel,
        startsAt: r.startsAt,
        startsAtHasTime: r.startsAtHasTime,
        status: freeEventStatus(r, now),
        isCurrent: r.slug === FREE_WEBINAR_SLUG,
        registrations: r._count.registrations,
      }))
  );
};

export type FreeEventRegistrant = {
  registrationId: string;
  contactId: string;
  name: string;
  email: string | null;
  phoneE164: string | null;
  registeredAt: Date;
  linkEmailSentAt: Date | null;
  lastSendError: string | null;
};

export type FreeEventDetail = FreeEventRow & {
  subheadline: string | null;
  meetUrl: string | null;
  endedAt: Date | null;
  archivedAt: Date | null;
  registrants: FreeEventRegistrant[];
};

const fullName = (c: { firstName: string | null; lastName: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ") || "Sin nombre";

/** Un evento con todas sus inscritas (para el detalle del historial). */
export const getFreeEventDetail = async (
  id: string
): Promise<FreeEventDetail | null> => {
  const row = await prisma.freeWebinar.findUnique({
    where: { id },
    include: {
      registrations: {
        orderBy: { createdAt: "desc" },
        include: {
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
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    headline: row.headline,
    eventLabel: row.eventLabel,
    subheadline: row.subheadline,
    startsAt: row.startsAt,
    startsAtHasTime: row.startsAtHasTime,
    status: freeEventStatus(row),
    isCurrent: row.slug === FREE_WEBINAR_SLUG,
    registrations: row.registrations.length,
    meetUrl: row.meetUrl,
    endedAt: row.endedAt,
    archivedAt: row.archivedAt,
    registrants: row.registrations.map((r) => ({
      registrationId: r.id,
      contactId: r.contact.id,
      name: fullName(r.contact),
      email: r.contact.email,
      phoneE164: r.contact.phoneE164,
      registeredAt: r.createdAt,
      linkEmailSentAt: r.linkEmailSentAt,
      lastSendError: r.lastSendError,
    })),
  };
};

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
};

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
  };
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
