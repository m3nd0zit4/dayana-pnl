/** Solo desarrollo local sin DATABASE_URL: UI mock sin APIs reales. */
export const isCrmUiPreview = (): boolean =>
  process.env.NODE_ENV === "development" &&
  process.env.CRM_UI_PREVIEW === "true" &&
  process.env.VERCEL_ENV !== "production" &&
  !process.env.DATABASE_URL?.trim();
