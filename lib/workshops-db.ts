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
 * Rendered on the /taller-virtual listing page, not the [slug] detail page:
 * that route redirects anonymous visitors away whenever the edition has a
 * linked product (see app/taller-virtual/[slug]/page.tsx), so it's not a
 * page crawlers ever actually see content on.
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

export { crmEditionWhere };
