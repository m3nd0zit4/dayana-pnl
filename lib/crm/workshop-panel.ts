import { EnrollmentStatus, Prisma, type WorkshopEdition, type WorkshopEditionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PROXIMO_WORKSHOP_SLUG } from "@/lib/workshops";
import { registrationsPerDay, summarizeFlag, type FlagSummary, type TimelineItem } from "./free-event-rules";
import { WHATSAPPABLE_CONTACT } from "./webinar-registrations";
import { listWorkshopActivities } from "./workshop-activity";
import { latestPricesFromRows, type EditionPrices } from "./workshop-editions";
import {
  buildWorkshopTimeline,
  isWorkshopEnded,
  sortWorkshopsForList,
  workshopStartsAtHasTime,
} from "./workshop-lifecycle-rules";
import { workshopProductIdFor } from "./workshop-price-rows";

/**
 * Consultas de solo lectura para la sección «Talleres» del panel: la lista
 * (como la de eventos), el detalle, sus inscritas pagadas y su historia. La
 * escritura vive en `workshop-editions.ts` y `workshop-lifecycle.ts`.
 */

const PAID = [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED];

/** «16 de mayo de 2026, 7:30 a. m.» en la zona del taller; el texto propio si no hay fecha. */
export const workshopDateLabel = (
  row: Pick<WorkshopEdition, "startsAt" | "timezone" | "dateLabel" | "daySchedule">,
  timeZone?: string
): string => {
  if (!row.startsAt) return row.dateLabel?.trim() || "Sin fecha";
  return row.startsAt.toLocaleString("es-CO", {
    timeZone: timeZone ?? row.timezone,
    dateStyle: "long",
    ...(workshopStartsAtHasTime(row) ? { timeStyle: "short" as const } : {}),
  });
};

export const workshopPublicPath = (slug: string) => `/taller-virtual/${slug}`;

export type WorkshopReminderStats = {
  paid: number;
  email24h: number;
  email1h: number;
  wa24h: number;
  wa1h: number;
};

const EMPTY_STATS: WorkshopReminderStats = { paid: 0, email24h: 0, email1h: 0, wa24h: 0, wa1h: 0 };

/** Contadores de todas las ediciones en una sola consulta agregada. */
const statsByEdition = async (): Promise<Map<string, WorkshopReminderStats>> => {
  const rows = await prisma.$queryRaw<
    { id: string; paid: number; e24: number; e1: number; w24: number; w1: number }[]
  >(Prisma.sql`
    SELECT workshop_edition_id AS id,
      count(*)::int AS paid,
      count(workshop_reminder_24h_sent_at)::int AS e24,
      count(workshop_reminder_1h_sent_at)::int AS e1,
      (count(*) FILTER (WHERE workshop_reminder_24h_wa_sent_at IS NOT NULL AND workshop_wa_reminder_error IS NULL))::int AS w24,
      (count(*) FILTER (WHERE workshop_reminder_1h_wa_sent_at IS NOT NULL AND workshop_wa_reminder_error IS NULL))::int AS w1
    FROM enrollments
    WHERE workshop_edition_id IS NOT NULL AND status IN ('ACTIVE', 'COMPLETED')
    GROUP BY workshop_edition_id
  `);
  return new Map(rows.map((r) => [r.id, { paid: r.paid, email24h: r.e24, email1h: r.e1, wa24h: r.w24, wa1h: r.w1 }]));
};

export type WorkshopListRow = {
  id: string;
  slug: string;
  title: string;
  status: WorkshopEditionStatus;
  ended: boolean;
  startsAt: Date | null;
  createdAt: Date;
  dateLabel: string;
  scheduleLabel: string | null;
  publicPath: string;
  prices: EditionPrices;
  /** Cobra con un paquete compartido heredado, no con su precio propio. */
  legacyProduct: boolean;
  hasMeetingUrl: boolean;
  stats: WorkshopReminderStats;
};

/** Todas las ediciones reales, en el orden de la lista de eventos. */
export const listWorkshopsForPanel = async (timeZone?: string): Promise<WorkshopListRow[]> => {
  const [rows, stats] = await Promise.all([
    prisma.workshopEdition.findMany({
      where: { slug: { not: PROXIMO_WORKSHOP_SLUG } },
      include: { product: { include: { prices: { orderBy: { validFrom: "desc" } } } } },
    }),
    statsByEdition(),
  ]);
  return sortWorkshopsForList(rows).map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    status: r.status,
    ended: isWorkshopEnded(r),
    startsAt: r.startsAt,
    createdAt: r.createdAt,
    dateLabel: workshopDateLabel(r, timeZone),
    scheduleLabel: r.scheduleLabel,
    publicPath: workshopPublicPath(r.slug),
    prices: latestPricesFromRows(r.product?.prices ?? []),
    legacyProduct: Boolean(r.productId && r.productId !== workshopProductIdFor(r.slug)),
    hasMeetingUrl: Boolean(r.meetingUrl),
    stats: stats.get(r.id) ?? EMPTY_STATS,
  }));
};

export type WorkshopForPanel = WorkshopEdition & {
  productTitle: string | null;
  prices: EditionPrices;
  legacyProduct: boolean;
  paidCount: number;
  documentsCount: number;
};

/** Una edición con su precio vigente, sus pagadas y sus documentos. */
export const getWorkshopForPanel = async (slug: string): Promise<WorkshopForPanel | null> => {
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    include: {
      product: { include: { prices: { orderBy: { validFrom: "desc" } } } },
      _count: { select: { documents: true } },
    },
  });
  if (!edition || edition.slug === PROXIMO_WORKSHOP_SLUG) return null;
  const { product, _count, ...rest } = edition;
  const paidCount = await prisma.enrollment.count({ where: { workshopEditionId: edition.id, status: { in: PAID } } });
  return {
    ...rest,
    productTitle: product?.title ?? null,
    prices: latestPricesFromRows(product?.prices ?? []),
    legacyProduct: Boolean(rest.productId && rest.productId !== workshopProductIdFor(rest.slug)),
    paidCount,
    documentsCount: _count.documents,
  };
};

/** La edición publicada ahora, si hay (para nombrarla al publicar otra). */
export const getOpenWorkshop = () =>
  prisma.workshopEdition.findFirst({
    where: { status: "OPEN", endedAt: null, slug: { not: PROXIMO_WORKSHOP_SLUG } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, slug: true, title: true },
  });

/** Las ediciones para «Copiar la página de…», la más reciente primero. */
export const listWorkshopCopySources = async (timeZone?: string) =>
  (
    await prisma.workshopEdition.findMany({
      where: { slug: { not: PROXIMO_WORKSHOP_SLUG } },
      orderBy: [{ startsAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      select: { id: true, title: true, startsAt: true, timezone: true, dateLabel: true, daySchedule: true },
      take: 50,
    })
  ).map((e) => ({ id: e.id, title: e.title, label: `${e.title} · ${workshopDateLabel(e, timeZone)}` }));

/* -------------------------------------------------------------------------
 * Inscritas (pagadas)
 * ---------------------------------------------------------------------- */

export type WorkshopEnrollmentStats = {
  total: number;
  email24h: number;
  email1h: number;
  noEmail: number;
  wa24h: number;
  wa1h: number;
  waFailed: number;
  noWhatsApp: number;
};

export const workshopEnrollmentStats = async (editionId: string): Promise<WorkshopEnrollmentStats> => {
  const base = { workshopEditionId: editionId, status: { in: PAID } } satisfies Prisma.EnrollmentWhereInput;
  const [total, email24h, email1h, noEmail, wa24h, wa1h, waFailed, noWhatsApp] = await Promise.all([
    prisma.enrollment.count({ where: base }),
    prisma.enrollment.count({ where: { ...base, workshopReminder24hSentAt: { not: null } } }),
    prisma.enrollment.count({ where: { ...base, workshopReminder1hSentAt: { not: null } } }),
    prisma.enrollment.count({
      where: { ...base, contact: { OR: [{ email: null }, { notifyEmail: false }] } },
    }),
    prisma.enrollment.count({
      where: { ...base, workshopReminder24hWaSentAt: { not: null }, workshopWaReminderError: null },
    }),
    prisma.enrollment.count({
      where: { ...base, workshopReminder1hWaSentAt: { not: null }, workshopWaReminderError: null },
    }),
    prisma.enrollment.count({ where: { ...base, workshopWaReminderError: { not: null } } }),
    prisma.enrollment.count({ where: { ...base, contact: { NOT: WHATSAPPABLE_CONTACT } } }),
  ]);
  return { total, email24h, email1h, noEmail, wa24h, wa1h, waFailed, noWhatsApp };
};

export const listWorkshopEnrollments = async (
  editionId: string,
  opts: { take?: number; skip?: number; q?: string; failedOnly?: boolean } = {}
) => {
  const q = opts.q?.trim();
  const rows = await prisma.enrollment.findMany({
    where: {
      workshopEditionId: editionId,
      status: { in: PAID },
      ...(opts.failedOnly ? { workshopWaReminderError: { not: null } } : {}),
      ...(q
        ? {
            contact: {
              OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { phoneE164: { contains: q.replace(/[^\d+]/g, "") || q } },
              ],
            },
          }
        : {}),
    },
    orderBy: [{ paidAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: opts.take ?? 50,
    skip: opts.skip ?? 0,
    select: {
      id: true,
      status: true,
      paidAt: true,
      createdAt: true,
      workshopReminder24hSentAt: true,
      workshopReminder1hSentAt: true,
      workshopReminder24hWaSentAt: true,
      workshopReminder1hWaSentAt: true,
      workshopWaReminderError: true,
      contact: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneE164: true,
          notifyEmail: true,
          notifyWhatsapp: true,
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    contactId: r.contact.id,
    name: [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") || "Sin nombre",
    email: r.contact.email,
    phoneE164: r.contact.phoneE164.startsWith("+nophone") ? null : r.contact.phoneE164,
    notifyEmail: r.contact.notifyEmail,
    notifyWhatsapp: r.contact.notifyWhatsapp,
    status: r.status,
    paidAtIso: (r.paidAt ?? r.createdAt).toISOString(),
    reminder24hSentAt: r.workshopReminder24hSentAt?.toISOString() ?? null,
    reminder1hSentAt: r.workshopReminder1hSentAt?.toISOString() ?? null,
    reminder24hWaSentAt: r.workshopReminder24hWaSentAt?.toISOString() ?? null,
    reminder1hWaSentAt: r.workshopReminder1hWaSentAt?.toISOString() ?? null,
    waReminderError: r.workshopWaReminderError,
  }));
};

export type WorkshopEnrollmentRow = Awaited<ReturnType<typeof listWorkshopEnrollments>>[number];

/** La edición de una matrícula, o null. */
export const enrollmentEditionId = async (enrollmentId: string): Promise<string | null> =>
  (await prisma.enrollment.findUnique({ where: { id: enrollmentId }, select: { workshopEditionId: true } }))
    ?.workshopEditionId ?? null;

/* -------------------------------------------------------------------------
 * WhatsApp
 * ---------------------------------------------------------------------- */

const ENROLLMENT_STATUS_LABEL: Partial<Record<EnrollmentStatus, string>> = {
  ACTIVE: "Pagó",
  COMPLETED: "Terminó",
  PENDING_PAYMENT: "Pendiente de pago",
  LEAD: "Interesada",
};

/** Las personas de la edición (cualquier estado), una por contacto. */
export const listWorkshopPeopleForWhatsApp = async (editionId: string) => {
  const rows = await prisma.enrollment.findMany({
    where: { workshopEditionId: editionId },
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      contact: { select: { id: true, firstName: true, lastName: true, phoneE164: true, email: true } },
    },
  });
  const seen = new Set<string>();
  return rows
    .filter((e) => (seen.has(e.contact.id) ? false : (seen.add(e.contact.id), true)))
    .map((e) => ({
      contactId: e.contact.id,
      name: [e.contact.firstName, e.contact.lastName].filter(Boolean).join(" "),
      detail: [
        ENROLLMENT_STATUS_LABEL[e.status] ?? e.status,
        e.contact.phoneE164.startsWith("+nophone") ? "sin número" : e.contact.phoneE164,
        e.contact.email,
      ]
        .filter(Boolean)
        .join(" · "),
    }));
};

/** A quién invitar: aceptaron novedades, tienen WhatsApp y no están en la edición. */
export const listWorkshopInviteContactIds = async (editionId: string): Promise<string[]> => {
  const inEdition = await prisma.enrollment.findMany({
    where: { workshopEditionId: editionId },
    select: { contactId: true },
  });
  const rows = await prisma.contact.findMany({
    where: {
      consentMarketingAt: { not: null },
      notifyWhatsapp: true,
      NOT: { phoneE164: { startsWith: "+nophone" } },
      id: { notIn: [...new Set(inEdition.map((r) => r.contactId))] },
    },
    select: { id: true },
    take: 2000,
  });
  return rows.map((r) => r.id);
};

/* -------------------------------------------------------------------------
 * Historia
 * ---------------------------------------------------------------------- */

export type WorkshopTimeline = {
  items: TimelineItem[];
  perDay: { day: string; count: number }[];
  enrollments: number;
  flags: {
    email24h: FlagSummary;
    email1h: FlagSummary;
    wa24h: FlagSummary;
    wa1h: FlagSummary;
    waErrors: number;
  };
};

/** La historia: actividad, envíos de WhatsApp, pagos por día y recordatorios. */
export const getWorkshopTimeline = async (id: string, timeZone: string): Promise<WorkshopTimeline> => {
  const [activities, sends, regs] = await Promise.all([
    listWorkshopActivities(id),
    prisma.whatsAppSend.findMany({
      where: { workshopEditionId: id },
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
    prisma.enrollment.findMany({
      where: { workshopEditionId: id, status: { in: PAID } },
      select: {
        paidAt: true,
        createdAt: true,
        workshopReminder24hSentAt: true,
        workshopReminder1hSentAt: true,
        workshopReminder24hWaSentAt: true,
        workshopReminder1hWaSentAt: true,
        workshopWaReminderError: true,
      },
    }),
  ]);
  return {
    items: buildWorkshopTimeline({ activities, sends }),
    perDay: registrationsPerDay(
      regs.map((r) => r.paidAt ?? r.createdAt),
      timeZone
    ),
    enrollments: regs.length,
    flags: {
      email24h: summarizeFlag(regs.map((r) => r.workshopReminder24hSentAt)),
      email1h: summarizeFlag(regs.map((r) => r.workshopReminder1hSentAt)),
      wa24h: summarizeFlag(regs.map((r) => r.workshopReminder24hWaSentAt)),
      wa1h: summarizeFlag(regs.map((r) => r.workshopReminder1hWaSentAt)),
      waErrors: regs.filter((r) => r.workshopWaReminderError).length,
    },
  };
};
