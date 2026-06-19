import {
  DEFAULT_OPEN_CTA,
  DEFAULT_TOPICS_SECTION_TITLE,
  splitTitleToHeroLines,
} from "../workshops";
import type { WorkshopEditionInput } from "./workshop-editions";

/** Rellena hero, resúmenes, SEO y WhatsApp a partir de título + descripción. */
export const enrichWorkshopInput = (
  input: WorkshopEditionInput
): WorkshopEditionInput => {
  const title = input.title.trim();
  const description =
    input.cardSummary?.trim() ||
    input.detailSummary?.trim() ||
    input.intro?.trim() ||
    title;

  const [heroLine1, heroLine2, heroLine3] = splitTitleToHeroLines(title);
  const whatsappDefault = `Hola Dayana, me interesa inscribirme al taller "${title}".`;

  return {
    ...input,
    title,
    cardSummary: description,
    detailSummary: description,
    intro: description,
    heroLine1,
    heroLine2,
    heroLine3,
    topicsSectionTitle:
      input.topicsSectionTitle?.trim() || DEFAULT_TOPICS_SECTION_TITLE,
    topicsSectionDescription: null,
    scheduleSectionDescription: null,
    metaTitle:
      input.metaTitle?.trim() ||
      `${title} | Taller Virtual | Dayana Beltrán PNL`,
    metaDescription: input.metaDescription?.trim() || description,
    whatsappTemplate: input.whatsappTemplate?.trim() || whatsappDefault,
    introOpen: input.introOpen?.trim() || DEFAULT_OPEN_CTA,
  };
};
