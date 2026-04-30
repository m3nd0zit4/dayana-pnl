export const ANALYTICS_CONSENT_KEY = "dayana_analytics_consent" as const;

export type AnalyticsConsentValue = "accepted" | "rejected";

export function readAnalyticsConsent(): AnalyticsConsentValue | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
  if (raw === "accepted" || raw === "rejected") return raw;
  return null;
}

export function writeAnalyticsConsent(value: AnalyticsConsentValue): void {
  window.localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
}
