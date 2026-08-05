export const WEBINAR_GRATUITO_TAG_SLUG = "webinar-gratuito";
export const WEBINAR_GRATUITO_TAG_LABEL = "Webinar gratuito";
export const WEBINAR_INTEREST_LABEL = "Webinar gratuito";

/** Case-insensitive match for webinar interest / sourceDetail strings. */
export const isWebinarInterest = (value: string | null | undefined): boolean => {
  if (!value) return false;
  const n = value.trim().toLowerCase();
  return (
    n === "webinar gratuito" ||
    n === "webinar-gratuito" ||
    n.includes("webinar gratuito")
  );
};
