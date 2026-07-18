import type { WorkshopEdition, WorkshopEditionStatus } from "@prisma/client";
import {
  DEFAULT_OPEN_CTA,
  DEFAULT_TOPICS_SECTION_TITLE,
  splitTitleToHeroLines,
  type WorkshopCard,
  type WorkshopDetail,
  type WorkshopStatus,
} from "./workshops";
import { parseWorkshopSchedule } from "./workshop-schedule";

export type WorkshopEditionRecord = Pick<
  WorkshopEdition,
  | "slug"
  | "title"
  | "editionLabel"
  | "cardSummary"
  | "status"
  | "dateLabel"
  | "scheduleLabel"
  | "whatsappTemplate"
  | "heroLine1"
  | "heroLine2"
  | "heroLine3"
  | "detailSummary"
  | "intro"
  | "focusTopics"
  | "daySchedule"
  | "topicsSectionTitle"
  | "topicsSectionDescription"
  | "scheduleSectionDescription"
  | "metaTitle"
  | "metaDescription"
  | "introOpen"
  | "productId"
>;

const statusToUi = (status: WorkshopEditionStatus): WorkshopStatus => {
  switch (status) {
    case "OPEN":
      return "open";
    case "COMPLETED":
      return "completed";
    default:
      return "upcoming";
  }
};

const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
};

export const mapEditionToCard = (edition: WorkshopEditionRecord): WorkshopCard => ({
  slug: edition.slug,
  status: statusToUi(edition.status),
  editionLabel: edition.editionLabel ?? "",
  title: edition.title,
  cardSummary: edition.cardSummary ?? "",
  dateLabel: edition.dateLabel ?? "",
  scheduleLabel: edition.scheduleLabel ?? "",
  whatsappMessage: edition.whatsappTemplate ?? undefined,
  productId: edition.productId,
});

export const mapEditionToDetail = (
  edition: WorkshopEditionRecord
): WorkshopDetail => {
  const card = mapEditionToCard(edition);
  const heroFromDb = [
    edition.heroLine1,
    edition.heroLine2,
    edition.heroLine3,
  ] as const;
  const heroLines =
    heroFromDb.some((line) => line?.trim())
      ? ([
          heroFromDb[0] ?? "",
          heroFromDb[1] ?? "",
          heroFromDb[2] ?? "",
        ] as [string, string, string])
      : splitTitleToHeroLines(edition.title);

  const whatsappMessage =
    edition.whatsappTemplate?.trim() ||
    "Hola Dayana, me interesa información sobre el taller virtual.";

  const metaTitle =
    edition.metaTitle?.trim() ||
    `${edition.title} | Taller Virtual | Dayana Beltrán PNL`;
  const metaDescription =
    edition.metaDescription?.trim() ||
    edition.cardSummary?.trim() ||
    edition.detailSummary?.trim() ||
    `Taller virtual ${edition.title} con Dayana Beltrán.`;

  return {
    ...card,
    productId: edition.productId,
    heroLines,
    detailSummary:
      edition.detailSummary?.trim() ||
      edition.cardSummary?.trim() ||
      edition.title,
    intro:
      edition.intro?.trim() ||
      "Jornada intensiva de transformación con Dayana Beltrán. Escríbenos por WhatsApp para inscribirte o resolver dudas.",
    focusTopics: parseStringArray(edition.focusTopics),
    daySchedule: parseWorkshopSchedule(edition.daySchedule),
    topicsSectionTitle:
      edition.topicsSectionTitle?.trim() || DEFAULT_TOPICS_SECTION_TITLE,
    topicsSectionDescription: edition.topicsSectionDescription?.trim() || "",
    scheduleSectionDescription:
      edition.scheduleSectionDescription?.trim() || "",
    whatsappMessage,
    metadata: {
      title: metaTitle,
      description: metaDescription,
    },
    ctaMessage: edition.introOpen?.trim() || DEFAULT_OPEN_CTA,
  };
};
