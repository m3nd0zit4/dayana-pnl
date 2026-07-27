/**
 * Cliente de la API de TikTok (open.tiktokapis.com, v2).
 *
 * OJO con el alcance real de esta integración: TikTok **no** ofrece API de
 * mensajes directos a una app normal (la Business Messaging API es beta y solo
 * para partners homologados), y la API de comentarios exige `advertiser_id`, o
 * sea que solo cubre anuncios. Por eso aquí solo hay publicación de contenido y
 * lectura de la propia cuenta — no hay bandeja de entrada que construir.
 */

export const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";
export const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";

/** Permisos mínimos para publicar y leer la propia cuenta. */
export const TIKTOK_SCOPES = [
  "user.info.basic",
  "video.publish",
  "video.upload",
  "video.list",
] as const;

export class TikTokApiError extends Error {
  readonly code: string;
  readonly logId?: string;
  readonly httpStatus: number;

  constructor(
    message: string,
    init: { code: string; logId?: string; httpStatus: number }
  ) {
    super(message);
    this.name = "TikTokApiError";
    this.code = init.code;
    this.logId = init.logId;
    this.httpStatus = init.httpStatus;
  }

  /** El usuario revocó el permiso o el token murió: hay que reconectar. */
  get needsReconnect(): boolean {
    return (
      this.httpStatus === 401 ||
      this.code === "access_token_invalid" ||
      this.code === "scope_not_authorized" ||
      this.code === "invalid_grant"
    );
  }

  get isRateLimited(): boolean {
    return this.httpStatus === 429 || this.code === "rate_limit_exceeded";
  }
}

type TikTokEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
};

/**
 * TikTok responde 200 con un `error.code` distinto de "ok" para muchos fallos,
 * así que no basta con mirar el status HTTP.
 */
export const tiktokPost = async <T>(
  path: string,
  body: unknown,
  accessToken: string
): Promise<T> => {
  const res = await fetch(`${TIKTOK_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body ?? {}),
  });

  const json = (await res.json().catch(() => ({}))) as TikTokEnvelope<T>;
  const code = json.error?.code ?? (res.ok ? "ok" : "http_error");

  if (!res.ok || (code !== "ok" && code !== "")) {
    throw new TikTokApiError(json.error?.message || `HTTP ${res.status}`, {
      code,
      logId: json.error?.log_id,
      httpStatus: res.status,
    });
  }

  return json.data as T;
};

export const tiktokGet = async <T>(
  path: string,
  params: Record<string, string>,
  accessToken: string
): Promise<T> => {
  const search = new URLSearchParams(params).toString();
  const res = await fetch(
    `${TIKTOK_API_BASE}${path}${search ? `?${search}` : ""}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const json = (await res.json().catch(() => ({}))) as TikTokEnvelope<T>;
  const code = json.error?.code ?? (res.ok ? "ok" : "http_error");

  if (!res.ok || (code !== "ok" && code !== "")) {
    throw new TikTokApiError(json.error?.message || `HTTP ${res.status}`, {
      code,
      logId: json.error?.log_id,
      httpStatus: res.status,
    });
  }

  return json.data as T;
};

// ── Configuración ──────────────────────────────────────────────────────────

export type TikTokConfig = {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
};

export const tiktokConfig = (): TikTokConfig | null => {
  const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  const siteUrl =
    process.env.TIKTOK_REDIRECT_URI?.trim() ||
    (process.env.NEXT_PUBLIC_SITE_URL?.trim()
      ? `${process.env.NEXT_PUBLIC_SITE_URL.trim().replace(/\/$/, "")}/api/admin/social/tiktok/callback`
      : null);

  if (!clientKey || !clientSecret || !siteUrl) return null;
  return { clientKey, clientSecret, redirectUri: siteUrl };
};

/**
 * Mientras TikTok no audite la app, solo se puede publicar en privado.
 *
 * Se declara por variable de entorno en vez de deducirlo: TikTok no expone
 * "¿estoy auditado?" en ninguna respuesta, y descubrirlo al fallar el envío es
 * demasiado tarde. Se pone en true el día que aprueben la auditoría.
 */
export const isTikTokAudited = (): boolean =>
  process.env.TIKTOK_AUDITED === "true";

export const isTikTokEnabled = (): boolean =>
  process.env.SOCIAL_PUBLISHING_ENABLED === "true" && tiktokConfig() !== null;
