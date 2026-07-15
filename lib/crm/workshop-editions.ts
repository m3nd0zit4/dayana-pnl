import { WorkshopEditionStatus } from "@prisma/client";
import { enrichWorkshopInput } from "./workshop-enrichment";
import { normalizeWorkshopSchedule } from "../workshop-schedule";
import { prisma } from "../db";
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
      ...(enriched.productId !== undefined
        ? enriched.productId
          ? { product: { connect: { id: enriched.productId } } }
          : { product: { disconnect: true } }
        : {}),
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
      ...(enriched.productId !== undefined
        ? enriched.productId
          ? { product: { connect: { id: enriched.productId } } }
          : { product: { disconnect: true } }
        : {}),
    },
  });
};
