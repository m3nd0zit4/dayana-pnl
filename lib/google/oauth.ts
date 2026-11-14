import type { GoogleService } from "@prisma/client";
import { getSiteUrl } from "@/lib/site-url";
import { ON_REQUEST_ONLY, missingServiceScopes, scopesForServices } from "./scopes";

/**
 * OAuth 2.0 de Google, flujo de servidor web, sin intermediarios.
 *
 * Módulo sin Prisma: la lectura y escritura de la cuenta se inyecta
 * (`GoogleTokenStore`), de modo que los tests prueban la lógica entera con un
 * almacén en memoria y un `fetch` simulado. `connect.ts` lo conecta a la base.
 *
 * Hasta el 14-nov-2026 esto pasaba por Vercel Connect, que guardaba el refresh
 * token por nosotros. Su cuota de «Connect token requests» se agotó y dejó a la
 * IA de WhatsApp sin poder agendar; además la app sale de Vercel. Ahora el
 * refresh token vive cifrado en `google_accounts.refresh_token_enc`.
 */

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
export const GOOGLE_CALLBACK_PATH = "/api/admin/google/callback";

/** Margen antes de la caducidad real: un token que caduca en vuelo falla igual. */
const EXPIRY_MARGIN_MS = 60_000;

export type GoogleOAuthClient = { clientId: string; clientSecret: string };

/**
 * El cliente OAuth. Por defecto el mismo del acceso con Google
 * (`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, ya definido en producción);
 * `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` lo sustituyen si un
 * día se quiere un cliente aparte. Se toma el par entero de una fuente: mezclar
 * el id de uno con el secreto de otro solo da `invalid_client`.
 */
export const googleOAuthClient = (): GoogleOAuthClient | null => {
  const ownId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const ownSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (ownId && ownSecret) return { clientId: ownId, clientSecret: ownSecret };

  const loginId = process.env.AUTH_GOOGLE_ID?.trim();
  const loginSecret = process.env.AUTH_GOOGLE_SECRET?.trim();
  if (loginId && loginSecret) return { clientId: loginId, clientSecret: loginSecret };
  return null;
};

/** Variables que hacen falta, para la pantalla de integraciones. */
export const GOOGLE_OAUTH_ENV = ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"] as const;

/**
 * URI de redirección. Google exige que coincida EXACTAMENTE con una registrada
 * en el cliente OAuth, así que es fija (sin query): la cuenta viaja en `state`.
 * `GOOGLE_OAUTH_REDIRECT_URI` la fija a mano (p. ej. al salir de Vercel);
 * si no, sale del dominio del sitio (`NEXT_PUBLIC_SITE_URL`).
 */
export const googleRedirectUri = (): string => {
  const explicit = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return new URL(GOOGLE_CALLBACK_PATH, `${getSiteUrl()}/`).toString();
};

export const buildAuthorizationUrl = (input: {
  client: GoogleOAuthClient;
  services: readonly GoogleService[];
  state: string;
  redirectUri: string;
  loginHint?: string | null;
}): string => {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", input.client.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopesForServices(input.services).join(" "));
  // offline + consent: es lo único que garantiza que Google entregue un
  // refresh token también al reconectar una cuenta que ya dio permiso.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
};

export type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
};

/** Error de Google en `/token`. `code` es el campo `error` (p. ej. `invalid_grant`). */
export class GoogleTokenError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    description?: string
  ) {
    super(`Google rechazó el token (${status} ${code})${description ? `: ${description}` : ""}`);
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const postToken = async (
  params: Record<string, string>,
  fetchImpl: FetchLike
): Promise<GoogleTokenResponse> => {
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<GoogleTokenResponse> & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new GoogleTokenError(
      json.error ?? `http_${res.status}`,
      res.status,
      json.error_description
    );
  }
  return json as GoogleTokenResponse;
};

export const exchangeAuthorizationCode = (input: {
  client: GoogleOAuthClient;
  code: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
}): Promise<GoogleTokenResponse> =>
  postToken(
    {
      grant_type: "authorization_code",
      code: input.code,
      client_id: input.client.clientId,
      client_secret: input.client.clientSecret,
      redirect_uri: input.redirectUri,
    },
    input.fetchImpl ?? fetch
  );

export const refreshAccessToken = (input: {
  client: GoogleOAuthClient;
  refreshToken: string;
  fetchImpl?: FetchLike;
}): Promise<GoogleTokenResponse> =>
  postToken(
    {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.client.clientId,
      client_secret: input.client.clientSecret,
    },
    input.fetchImpl ?? fetch
  );

export const parseGrantedScopes = (scope: string | undefined): string[] =>
  Array.from(new Set((scope ?? "").split(/\s+/).filter(Boolean)));

export type GoogleAccountIdentity = {
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

/**
 * Quién es la cuenta, con el access token recién emitido. Si falla la cuenta
 * se conecta igual: perder la etiqueta es cosmético, perder la conexión no.
 */
export const fetchGoogleIdentity = async (
  accessToken: string,
  fetchImpl: FetchLike = fetch
): Promise<GoogleAccountIdentity> => {
  try {
    const res = await fetchImpl(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`userinfo HTTP ${res.status}`);
    const info = (await res.json()) as { email?: string; name?: string; picture?: string };
    return {
      email: info.email ?? null,
      displayName: info.name ?? null,
      avatarUrl: info.picture ?? null,
    };
  } catch {
    return { email: null, displayName: null, avatarUrl: null };
  }
};

// ---------------------------------------------------------------------------
// Access tokens por cuenta
// ---------------------------------------------------------------------------

/** La cuenta existe pero hay que volver a pasar por el consentimiento. */
export class GoogleReauthorizationRequiredError extends Error {
  constructor(public readonly accountId: string, message?: string) {
    super(
      message ??
        "La cuenta de Google ya no está autorizada. Vuelve a conectarla en Ajustes → Integraciones → Google («Volver a conectar con Google»)."
    );
  }
}

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super(
      "Google no está configurado: faltan AUTH_GOOGLE_ID y AUTH_GOOGLE_SECRET (el cliente OAuth de Google)."
    );
  }
}

/** Mensaje para las cuentas que se conectaron por Vercel Connect (sin refresh token propio). */
export const RECONNECT_ONCE_MESSAGE =
  "Esta cuenta se conectó con el sistema anterior (Vercel Connect), que ya no se usa. Vuelve a conectarla una sola vez en Ajustes → Integraciones → Google con «Volver a conectar con Google».";

export const SCOPES_MISSING_MESSAGE =
  "Google no dio todos los permisos de los servicios marcados. Vuelve a conectar la cuenta y deja marcadas todas las casillas que pide Google.";

export type StoredGoogleAccount = {
  id: string;
  isActive: boolean;
  services: GoogleService[];
  refreshTokenEnc: string | null;
  grantedScopes: string[];
};

export type GoogleTokenStore = {
  load(accountId: string): Promise<StoredGoogleAccount | null>;
  /** Apaga la cuenta y deja el motivo visible en la UI. */
  markNeedsReauthorization(accountId: string, reason: string): Promise<void>;
  /** Google rara vez rota el refresh token; si lo hace, se guarda el nuevo. */
  saveRotatedRefreshToken(accountId: string, refreshToken: string): Promise<void>;
  open(sealed: string): string;
};

type CachedToken = { token: string; expiresAt: number; refreshTokenEnc: string };

/**
 * Crea el proveedor de access tokens. Cachea uno por cuenta en el proceso hasta
 * ~60 s antes de que caduque y comparte la misma promesa entre peticiones
 * simultáneas, así que una ráfaga de tools no dispara una ráfaga a Google.
 *
 * El token cubre todos los scopes concedidos; qué servicios puede usar cada
 * llamada lo decide la comprobación contra `grantedScopes` y `services`.
 */
export const createGoogleTokenProvider = (deps: {
  store: GoogleTokenStore;
  client: () => GoogleOAuthClient | null;
  fetchImpl?: FetchLike;
  now?: () => number;
}) => {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, CachedToken>();
  const inflight = new Map<string, Promise<CachedToken>>();

  const reauth = async (accountId: string, reason: string) => {
    cache.delete(accountId);
    await deps.store.markNeedsReauthorization(accountId, reason);
    return new GoogleReauthorizationRequiredError(accountId, reason);
  };

  const refresh = async (account: StoredGoogleAccount & { refreshTokenEnc: string }) => {
    const client = deps.client();
    if (!client) throw new GoogleNotConfiguredError();
    let response: GoogleTokenResponse;
    try {
      response = await refreshAccessToken({
        client,
        refreshToken: deps.store.open(account.refreshTokenEnc),
        fetchImpl: deps.fetchImpl,
      });
    } catch (error) {
      // invalid_grant = permiso revocado, contraseña cambiada o token caducado
      // (7 días si la app sigue «en pruebas»). Nada que reintentar.
      if (error instanceof GoogleTokenError && error.code === "invalid_grant") {
        throw await reauth(
          account.id,
          "Google retiró el permiso de esta cuenta (invalid_grant). Vuelve a conectarla."
        );
      }
      // Cualquier otra cosa (red, 5xx, cliente mal configurado) no apaga la cuenta.
      throw error;
    }
    if (response.refresh_token) {
      await deps.store.saveRotatedRefreshToken(account.id, response.refresh_token);
    }
    return {
      token: response.access_token,
      expiresAt: now() + (response.expires_in ?? 3600) * 1000,
      refreshTokenEnc: account.refreshTokenEnc,
    };
  };

  const getAccountToken = async (
    accountId: string,
    /** Solo estos servicios (p. ej. `["MEET"]`); por defecto los de la cuenta menos Meet. */
    only?: readonly GoogleService[]
  ): Promise<string> => {
    const account = await deps.store.load(accountId);
    if (!account) throw new Error("La cuenta de Google no existe.");
    if (!account.isActive) throw new GoogleReauthorizationRequiredError(accountId);
    if (!account.refreshTokenEnc) throw await reauth(accountId, RECONNECT_ONCE_MESSAGE);

    const services = only
      ? only.filter((s) => account.services.includes(s))
      : account.services.filter((s) => !ON_REQUEST_ONLY.includes(s));
    if (missingServiceScopes(services, account.grantedScopes).length > 0) {
      // Sin el permiso de Meet la cuenta sigue sirviendo para lo demás: no se apaga.
      if (only && only.every((s) => ON_REQUEST_ONLY.includes(s))) {
        throw new GoogleReauthorizationRequiredError(
          accountId,
          "Esta cuenta no dio permiso de Meet. Vuelve a conectarla con Meet marcado."
        );
      }
      throw await reauth(accountId, SCOPES_MISSING_MESSAGE);
    }

    const cached = cache.get(accountId);
    if (
      cached &&
      cached.refreshTokenEnc === account.refreshTokenEnc &&
      cached.expiresAt - EXPIRY_MARGIN_MS > now()
    ) {
      return cached.token;
    }

    let pending = inflight.get(accountId);
    if (!pending) {
      pending = refresh({ ...account, refreshTokenEnc: account.refreshTokenEnc });
      inflight.set(accountId, pending);
      pending
        .then((fresh) => cache.set(accountId, fresh))
        .catch(() => undefined)
        .finally(() => inflight.delete(accountId));
    }
    return (await pending).token;
  };

  return {
    getAccountToken,
    /** Olvida el token cacheado (al reconectar o desconectar). */
    forget: (accountId: string) => {
      cache.delete(accountId);
      inflight.delete(accountId);
    },
  };
};
