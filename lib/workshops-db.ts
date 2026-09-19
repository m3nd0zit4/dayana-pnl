import { WorkshopEditionStatus } from "@prisma/client";
import { prisma } from "./db";
import {
  mapEditionToCard,
  mapEditionToDetail,
  type WorkshopEditionRecord,
} from "./workshop-edition-mapper";
import {
  PROXIMO_WORKSHOP_SLUG,
  WORKSHOPS,
  buildPublicWorkshopListing,
  type WorkshopCard,
  type WorkshopDetail,
} from "./workshops";

const editionSelect = {
  slug: true,
  title: true,
  editionLabel: true,
  cardSummary: true,
  status: true,
  dateLabel: true,
  scheduleLabel: true,
  startsAt: true,
  timezone: true,
  whatsappTemplate: true,
  heroLine1: true,
  heroLine2: true,
  heroLine3: true,
  detailSummary: true,
  intro: true,
  focusTopics: true,
  daySchedule: true,
  topicsSectionTitle: true,
  topicsSectionDescription: true,
  scheduleSectionDescription: true,
  metaTitle: true,
  metaDescription: true,
  introOpen: true,
  productId: true,
} satisfies Record<keyof WorkshopEditionRecord, true>;

const crmEditionWhere = {
  slug: { not: PROXIMO_WORKSHOP_SLUG },
} as const;

export const getWorkshopsFromDb = async (): Promise<WorkshopCard[]> => {
  try {
    const editions = await prisma.workshopEdition.findMany({
      where: crmEditionWhere,
      orderBy: { startsAt: "desc" },
      select: editionSelect,
    });

    if (editions.length === 0) return WORKSHOPS;

    return buildPublicWorkshopListing(editions.map(mapEditionToCard));
  } catch {
    return WORKSHOPS;
  }
};

export const getOpenWorkshopDetailBySlug = async (
  slug: string
): Promise<WorkshopDetail | null> => {
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: editionSelect,
  });

  if (
    !edition ||
    edition.slug === PROXIMO_WORKSHOP_SLUG ||
    edition.status !== WorkshopEditionStatus.OPEN
  ) {
    return null;
  }

  return mapEditionToDetail(edition);
};

/**
 * OWNER-only CRM preview: same shape as getOpenWorkshopDetailBySlug but
 * without the OPEN-status restriction, so DRAFT/CLOSED editions can be
 * reviewed before publish. Never used on a public route.
 */
export const getWorkshopDetailForPreview = async (
  slug: string
): Promise<WorkshopDetail | null> => {
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: editionSelect,
  });

  if (!edition || edition.slug === PROXIMO_WORKSHOP_SLUG) {
    return null;
  }

  return mapEditionToDetail(edition);
};

export const getActiveOpenWorkshop = async (): Promise<WorkshopDetail | null> => {
  const edition = await prisma.workshopEdition.findFirst({
    where: {
      status: WorkshopEditionStatus.OPEN,
      slug: { not: PROXIMO_WORKSHOP_SLUG },
    },
    orderBy: { updatedAt: "desc" },
    select: editionSelect,
  });

  if (!edition) return null;
  return mapEditionToDetail(edition);
};

/**
 * Raw event timing for JSON-LD — kept separate from the display DTO.
 * Rendered on the /taller-virtual listing page (the [slug] detail page has
 * its own sales-page markup for non-buyers now, see
 * app/taller-virtual/[slug]/page.tsx).
 */
export const getWorkshopEventTiming = async (
  slug: string
): Promise<{
  startsAt: Date | null;
  endsAt: Date | null;
  status: WorkshopEditionStatus;
} | null> => {
  return prisma.workshopEdition.findUnique({
    where: { slug },
    select: { startsAt: true, endsAt: true, status: true },
  });
};

/**
 * Any-status detail lookup for the public [slug] page's sales/closed states.
 *
 * `getOpenWorkshopDetailBySlug` only returns OPEN editions — that's correct
 * for the classic "does this exist for sale" check, but it means a
 * CLOSED/COMPLETED edition looks exactly like a missing one, so the page
 * can't render a "registrations closed" or "this already happened" state for
 * it. This returns the DTO regardless of status; DRAFT is still not meant to
 * be public — the page itself keeps treating DRAFT as not-found for
 * non-owners, the same way it always has.
 */
export const getWorkshopDetailBySlugAnyStatus = async (
  slug: string
): Promise<WorkshopDetail | null> => {
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: editionSelect,
  });

  if (!edition || edition.slug === PROXIMO_WORKSHOP_SLUG) {
    return null;
  }

  return mapEditionToDetail(edition);
};

/**
 * Raw status + informational capacity for a slug — kept out of the display
 * DTO (`WorkshopCard`/`WorkshopDetail` don't carry either field) so this
 * stays a tiny, separate lookup rather than reshaping the shared mapper.
 * Used by the [slug] sales page to tell DRAFT/CLOSED/COMPLETED apart (the
 * DTO's UI status collapses DRAFT and CLOSED into the same "upcoming" value)
 * and to show the informational capacity line.
 */
export const getWorkshopMetaBySlug = async (
  slug: string
): Promise<{ status: WorkshopEditionStatus; capacity: number | null } | null> => {
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: { status: true, capacity: true },
  });
  return edition ?? null;
};

/**
 * Enlace de reunión (Zoom/Meet) de una edición — deliberadamente FUERA de
 * `editionSelect`/`WorkshopDetail`: ese DTO también alimenta
 * `WorkshopSalesPage`, que se le muestra a quien todavía no pagó. Esta
 * consulta aparte es la única forma de leer `meetingUrl`, y quien la llama
 * debe comprobar `hasAccess` primero (ver app/taller-virtual/[slug]/page.tsx).
 */
export const getWorkshopMeetingUrl = async (
  slug: string
): Promise<string | null> => {
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: { meetingUrl: true },
  });
  return edition?.meetingUrl ?? null;
};

export { crmEditionWhere };

/**
 * Slugs de las ediciones con página pública para el sitemap: abiertas,
 * cerradas o ya realizadas. Los borradores responden 404 a quien no es del
 * equipo y el marcador «próximo taller» no es una edición real.
 */
export const listPublicWorkshopSlugs = async (): Promise<string[]> => {
  const rows = await prisma.workshopEdition.findMany({
    where: {
      ...crmEditionWhere,
      status: {
        in: [
          WorkshopEditionStatus.OPEN,
          WorkshopEditionStatus.CLOSED,
          WorkshopEditionStatus.COMPLETED,
        ],
      },
    },
    select: { slug: true },
  });
  return rows.map((r) => r.slug);
};
