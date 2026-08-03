declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

/** Pushes a structured event onto GTM's dataLayer. No-ops server-side and
 *  before consent is granted — callers are expected to already be
 *  consent-gated (via useCookieConsent) before importing this. */
export function pushDataLayerEvent(
  event: string,
  payload: Record<string, unknown> = {}
): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event, ...payload });
}
