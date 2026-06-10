/** Solo desarrollo: ver /admin sin login ni DB (CRM_UI_PREVIEW=true en .env). */
export const isCrmUiPreview = (): boolean =>
  process.env.NODE_ENV === "development" &&
  process.env.CRM_UI_PREVIEW === "true" &&
  process.env.VERCEL_ENV !== "production";
