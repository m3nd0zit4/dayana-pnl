/**
 * Consentimiento de cookies por finalidad.
 *
 * Analítica y publicidad son finalidades distintas: aceptar medir el uso del
 * sitio no es aceptar que Meta y Google reciban datos para segmentar anuncios.
 * Por eso son dos casillas y no una, y por eso la migración desde la clave
 * antigua nunca concede `marketing`.
 */

export const CONSENT_STORAGE_KEY = "dayana_consent_v2" as const;

/** Clave de la versión anterior (una sola opción: analítica sí/no). */
export const LEGACY_CONSENT_KEY = "dayana_analytics_consent" as const;

export type ConsentCategories = {
  /** Vercel Analytics, Speed Insights, GA4. */
  analytics: boolean;
  /** Meta Pixel + CAPI, Google Ads. */
  marketing: boolean;
};

export const CONSENT_DENIED: ConsentCategories = {
  analytics: false,
  marketing: false,
};

export const CONSENT_GRANTED: ConsentCategories = {
  analytics: true,
  marketing: true,
};

const isConsentShape = (value: unknown): value is ConsentCategories =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as ConsentCategories).analytics === "boolean" &&
  typeof (value as ConsentCategories).marketing === "boolean";

/**
 * Migración desde la clave antigua.
 *
 * `"accepted"` en la versión anterior significaba "acepto analítica" — nadie
 * consintió publicidad, así que `marketing` queda en false. Subirlo a true
 * sería fabricar un consentimiento que el usuario nunca dio.
 */
const readLegacyConsent = (): ConsentCategories | null => {
  const raw = window.localStorage.getItem(LEGACY_CONSENT_KEY);
  if (raw === "accepted") return { analytics: true, marketing: false };
  if (raw === "rejected") return CONSENT_DENIED;
  return null;
};

/** `null` = sin decisión todavía (hay que mostrar el banner). */
export function readConsent(): ConsentCategories | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isConsentShape(parsed)) {
        return { analytics: parsed.analytics, marketing: parsed.marketing };
      }
    } catch {
      /* JSON corrupto: se trata como si no hubiera decisión */
    }
  }

  const legacy = readLegacyConsent();
  if (legacy) {
    // Se reescribe en el formato nuevo para no volver a leer la clave vieja.
    writeConsent(legacy);
    return legacy;
  }

  return null;
}

export function writeConsent(value: ConsentCategories): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    CONSENT_STORAGE_KEY,
    JSON.stringify({ analytics: value.analytics, marketing: value.marketing })
  );
}
