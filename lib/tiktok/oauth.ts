import crypto from "crypto";
import { prisma } from "@/lib/db";
import { openSecret, sealSecret } from "@/lib/crypto/secret-box";
import {
  TIKTOK_API_BASE,
  TIKTOK_AUTH_URL,
  TIKTOK_SCOPES,
  TikTokApiError,
  tiktokConfig,
} from "./client";

/**
 * Login Kit de TikTok (OAuth 2.0).
 *
 * Nadie comparte contraseñas: Dayana inicia sesión en el dominio de TikTok y
 * nos devuelve un token con los permisos que apruebe.
 */

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
  token_type: string;
};

/** El `state` va firmado para que el callback no acepte uno fabricado. */
export const buildAuthorizationUrl = (
  staffUserId: string
): { url: string; state: string } | null => {
  const config = tiktokConfig();
  if (!config) return null;

  const nonce = crypto.randomBytes(16).toString("base64url");
  const payload = `${staffUserId}.${Date.now()}.${nonce}`;
  const signature = crypto
    .createHmac("sha256", process.env.AUTH_SECRET ?? "")
    .update(payload)
    .digest("base64url");
  const state = `${payload}.${signature}`;

  const params = new URLSearchParams({
    client_key: config.clientKey,
    scope: TIKTOK_SCOPES.join(","),
    response_type: "code",
    redirect_uri: config.redirectUri,
    state,
  });

  return { url: `${TIKTOK_AUTH_URL}?${params}`, state };
};

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export const verifyState = (state: string): { staffUserId: string } | null => {
  const parts = state.split(".");
  if (parts.length !== 4) return null;

  const [staffUserId, issuedAt, nonce, signature] = parts;
  const expected = crypto
    .createHmac("sha256", process.env.AUTH_SECRET ?? "")
    .update(`${staffUserId}.${issuedAt}.${nonce}`)
    .digest("base64url");

  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  // Un state viejo suele ser una pestaña abandonada, pero limitar la ventana
  // reduce el margen para reutilizarlo.
  if (Date.now() - Number(issuedAt) > STATE_MAX_AGE_MS) return null;

  return { staffUserId };
};

const requestToken = async (
  body: Record<string, string>
): Promise<TokenResponse> => {
  const res = await fetch(`${TIKTOK_API_BASE}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  const json = (await res.json().catch(() => ({}))) as TokenResponse & {
    error?: string;
    error_description?: string;
    log_id?: string;
  };

  if (!res.ok || json.error || !json.access_token) {
    throw new TikTokApiError(
      json.error_description || json.error || `HTTP ${res.status}`,
      { code: json.error ?? "token_error", httpStatus: res.status, logId: json.log_id }
    );
  }

  return json;
};

export const exchangeCodeForToken = (code: string) => {
  const config = tiktokConfig();
  if (!config) throw new Error("TikTok no está configurado.");

  return requestToken({
    client_key: config.clientKey,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });
};

/** Guarda (o actualiza) la cuenta conectada con los tokens cifrados. */
export const persistAccount = async (
  token: TokenResponse,
  staffUserId: string,
  profile?: { displayName?: string; username?: string; avatarUrl?: string }
) => {
  const now = Date.now();
  const data = {
    accessTokenEnc: sealSecret(token.access_token),
    refreshTokenEnc: token.refresh_token ? sealSecret(token.refresh_token) : null,
    expiresAt: new Date(now + token.expires_in * 1000),
    refreshExpiresAt: token.refresh_expires_in
      ? new Date(now + token.refresh_expires_in * 1000)
      : null,
    scopes: token.scope,
    isActive: true,
    lastError: null,
    displayName: profile?.displayName ?? null,
    username: profile?.username ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
  };

  return prisma.socialAccount.upsert({
    where: {
      provider_externalId: { provider: "TIKTOK", externalId: token.open_id },
    },
    create: {
      provider: "TIKTOK",
      externalId: token.open_id,
      connectedByStaffId: staffUserId,
      ...data,
    },
    update: data,
    select: { id: true, displayName: true, username: true },
  });
};

/** Margen para no usar un token que caduca durante la propia petición. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * Devuelve un access token válido, refrescándolo si hace falta.
 *
 * TikTok rota el refresh token en cada uso, así que hay que guardar el nuevo o
 * la siguiente renovación falla.
 */
export const getValidAccessToken = async (accountId: string): Promise<string> => {
  const account = await prisma.socialAccount.findUnique({
    where: { id: accountId },
  });
  if (!account) throw new Error("La cuenta conectada no existe.");
  if (!account.isActive) {
    throw new Error("La cuenta de TikTok está desconectada. Vuelve a conectarla.");
  }

  const stillValid =
    account.expiresAt &&
    account.expiresAt.getTime() - REFRESH_SKEW_MS > Date.now();
  if (stillValid) return openSecret(account.accessTokenEnc);

  if (!account.refreshTokenEnc) {
    throw new Error("No hay refresh token guardado. Vuelve a conectar TikTok.");
  }
  if (account.refreshExpiresAt && account.refreshExpiresAt < new Date()) {
    await prisma.socialAccount.update({
      where: { id: accountId },
      data: { isActive: false, lastError: "refresh_token_expired" },
    });
    throw new Error(
      "La autorización de TikTok caducó. Hay que volver a conectar la cuenta."
    );
  }

  const config = tiktokConfig();
  if (!config) throw new Error("TikTok no está configurado.");

  try {
    const refreshed = await requestToken({
      client_key: config.clientKey,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: openSecret(account.refreshTokenEnc),
    });

    const now = Date.now();
    await prisma.socialAccount.update({
      where: { id: accountId },
      data: {
        accessTokenEnc: sealSecret(refreshed.access_token),
        // TikTok rota el refresh token: guardar el nuevo es obligatorio.
        refreshTokenEnc: refreshed.refresh_token
          ? sealSecret(refreshed.refresh_token)
          : account.refreshTokenEnc,
        expiresAt: new Date(now + refreshed.expires_in * 1000),
        refreshExpiresAt: refreshed.refresh_expires_in
          ? new Date(now + refreshed.refresh_expires_in * 1000)
          : account.refreshExpiresAt,
        lastError: null,
      },
    });

    return refreshed.access_token;
  } catch (e) {
    const message = e instanceof Error ? e.message : "refresh_failed";
    await prisma.socialAccount.update({
      where: { id: accountId },
      data: {
        lastError: message,
        ...(e instanceof TikTokApiError && e.needsReconnect
          ? { isActive: false }
          : {}),
      },
    });
    throw e;
  }
};
