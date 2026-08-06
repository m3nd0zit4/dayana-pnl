import { WorkshopEditionStatus } from "@prisma/client";
import { enrichWorkshopInput } from "./workshop-enrichment";
import { normalizeWorkshopSchedule } from "../workshop-schedule";
import { prisma } from "../db";
import { crmEditionWhere } from "../workshops-db";
import { uniqueSlug } from "./slug";
export type WorkshopEditionInput = {
  slug?: string;
  title: string;
  editionLabel?: string | null;
  cardSummary?: string | null;
  status?: WorkshopEditionStatus;
  dateLabel?: string | null;
  scheduleLabel?: string | null;
  capacity?: number | null;
  whatsappTemplate?: string | null;
  startsAt?: Date | null;
  timezone?: string | null;
  productId?: string | null;
  heroLine1?: string | null;
  heroLine2?: string | null;
  heroLine3?: string | null;
  detailSummary?: string | null;
  intro?: string | null;
  focusTopics?: string[] | null;
  daySchedule?: { startTime: string; endTime: string; title: string; time?: string }[] | null;
  topicsSectionTitle?: string | null;
  topicsSectionDescription?: string | null;
  scheduleSectionDescription?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  introOpen?: string | null;
};

const editionData = (input: WorkshopEditionInput) => ({
  title: input.title,
  editionLabel: input.editionLabel ?? null,
  cardSummary: input.cardSummary ?? null,
  dateLabel: input.dateLabel ?? null,
  scheduleLabel: input.scheduleLabel ?? null,
  capacity: input.capacity ?? null,
  whatsappTemplate: input.whatsappTemplate ?? null,
  startsAt: input.startsAt ?? null,
  timezone: input.timezone ?? "America/Bogota",
  heroLine1: input.heroLine1 ?? null,
  heroLine2: input.heroLine2 ?? null,
  heroLine3: input.heroLine3 ?? null,
  detailSummary: input.detailSummary ?? null,
  intro: input.intro ?? null,
  focusTopics: input.focusTopics ?? undefined,
  daySchedule: input.daySchedule
    ? normalizeWorkshopSchedule(input.daySchedule)
    : undefined,
  topicsSectionTitle: input.topicsSectionTitle ?? null,
  topicsSectionDescription: input.topicsSectionDescription ?? null,
  scheduleSectionDescription: input.scheduleSectionDescription ?? null,
  metaTitle: input.metaTitle ?? null,
  metaDescription: input.metaDescription ?? null,
  introOpen: input.introOpen ?? null,
});

/**
 * Prisma update fragment for the product relation: undefined = leave the
 * existing link untouched, null/"" = disconnect, id = connect. Shared by
 * both write paths so the omitted/null/id contract can't drift.
 */
const productRelationUpdate = (productId: string | null | undefined) =>
  productId !== undefined
    ? productId
      ? { product: { connect: { id: productId } } }
      : { product: { disconnect: true as const } }
    : {};

export const closeOtherOpenWorkshops = async (exceptSlug?: string) => {
  await prisma.workshopEdition.updateMany({
    where: {
      status: WorkshopEditionStatus.OPEN,
      ...(exceptSlug ? { slug: { not: exceptSlug } } : {}),
    },
    data: { status: WorkshopEditionStatus.CLOSED },
  });
};

export const upsertWorkshopEdition = async (
  slug: string,
  input: WorkshopEditionInput
) => {
  const enriched = enrichWorkshopInput(input);
  const status = enriched.status ?? WorkshopEditionStatus.DRAFT;

  if (status === WorkshopEditionStatus.OPEN) {
    await closeOtherOpenWorkshops(slug);
  }

  return prisma.workshopEdition.upsert({
    where: { slug },
    create: {
      slug,
      status,
      ...editionData(enriched),
      ...(enriched.productId
        ? { product: { connect: { id: enriched.productId } } }
        : {}),
    },
    update: {
      ...editionData(enriched),
      status,
      ...productRelationUpdate(enriched.productId),
    },
  });
};

export const updateWorkshopEditionBySlug = async (
  slug: string,
  input: WorkshopEditionInput
) => {
  const enriched = enrichWorkshopInput(input);

  if (enriched.status === WorkshopEditionStatus.OPEN) {
    await closeOtherOpenWorkshops(slug);
  }

  return prisma.workshopEdition.update({
    where: { slug },
    data: {
      ...editionData(enriched),
      ...(enriched.status !== undefined ? { status: enriched.status } : {}),
      ...productRelationUpdate(enriched.productId),
    },
  });
};

/** Same filter/order the admin workshops list route uses — every real edition, newest first, excluding the virtual "proximo-taller" placeholder. */
export const listWorkshopEditionsAdmin = async () =>
  prisma.workshopEdition.findMany({
    where: crmEditionWhere,
    orderBy: { createdAt: "desc" },
  });

export const getWorkshopEditionBySlug = async (slug: string) =>
  prisma.workshopEdition.findUnique({
    where: { slug },
    include: { product: { include: { prices: true } } },
  });

/** Same slug-generation the admin create route uses (app/api/admin/workshops/route.ts) — collision-checked against real WorkshopEdition rows. */
export const generateWorkshopSlug = async (title: string) =>
  uniqueSlug(title, async (s) => !!(await prisma.workshopEdition.findUnique({ where: { slug: s } })));

export const listWorkshopDocuments = (workshopEditionId: string) =>
  prisma.workshopDocument.findMany({
    where: { workshopEditionId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

/** WorkshopDetail (the public DTO) only carries a slug, not the edition's
 *  id — resolve it here rather than threading a new field through that type. */
export const listWorkshopDocumentsBySlug = async (slug: string) => {
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: { id: true },
  });
  return edition ? listWorkshopDocuments(edition.id) : [];
};

export const createWorkshopDocument = (input: {
  workshopEditionId: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) => prisma.workshopDocument.create({ data: input });

export const deleteWorkshopDocument = async (id: string) => {
  const doc = await prisma.workshopDocument.findUnique({ where: { id } });
  if (!doc) return null;
  await prisma.workshopDocument.delete({ where: { id } });
  return doc;
};
