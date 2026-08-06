import { prisma } from "@/lib/db";
import {
  WEBINAR_GRATUITO_TAG_LABEL,
  WEBINAR_GRATUITO_TAG_SLUG,
} from "@/lib/crm/webinar-interest";

export {
  WEBINAR_GRATUITO_TAG_SLUG,
  WEBINAR_GRATUITO_TAG_LABEL,
  WEBINAR_INTEREST_LABEL,
  isWebinarInterest,
} from "@/lib/crm/webinar-interest";

/**
 * Ensures a Tag exists and attaches it to the contact. Idempotent.
 */
export const ensureContactTag = async (
  contactId: string,
  slug: string,
  label: string
): Promise<void> => {
  const tag = await prisma.tag.upsert({
    where: { slug },
    create: { slug, label },
    update: {},
  });

  await prisma.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId: tag.id } },
    create: { contactId, tagId: tag.id },
    update: {},
  });
};

export const ensureWebinarGratuitoTag = async (
  contactId: string
): Promise<void> =>
  ensureContactTag(
    contactId,
    WEBINAR_GRATUITO_TAG_SLUG,
    WEBINAR_GRATUITO_TAG_LABEL
  );

export const contactHasTag = async (
  contactId: string,
  slug: string
): Promise<boolean> => {
  const row = await prisma.contactTag.findFirst({
    where: { contactId, tag: { slug } },
    select: { contactId: true },
  });
  return Boolean(row);
};
