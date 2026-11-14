import type { GoogleService } from "@prisma/client";
import { prisma } from "@/lib/db";
import { openSecret, sealSecret } from "@/lib/crypto/secret-box";
import {
  GoogleNotConfiguredError,
  buildAuthorizationUrl,
  createGoogleTokenProvider,
  exchangeAuthorizationCode,
  fetchGoogleIdentity,
  googleOAuthClient,
  googleRedirectUri,
  parseGrantedScopes,
  type GoogleAccountIdentity,
} from "./oauth";
import { signOAuthState } from "./oauth-state";

/**
 * Único punto que habla con el OAuth de Google.
 *
 * El refresh token de cada cuenta se guarda cifrado (`lib/crypto/secret-box.ts`,
 * mismo patrón que TikTok) en `google_accounts.refresh_token_enc`, y
 * `getAccountToken` lo cambia por un access token corto que se cachea en el
 * proceso hasta poco antes de caducar. La lógica vive en `oauth.ts` (sin
 * Prisma, probada en `oauth.test.ts`); aquí solo se conecta a la base.
 *
 * Antes (hasta el 14-nov-2026) esto iba por Vercel Connect; ver CLAUDE.md →
 * «Cuentas de Google».
 */

export {
  SERVICE_SCOPES,
  SERVICE_LABELS,
  scopesForServices,
} from "./scopes";
export {
  GOOGLE_OAUTH_ENV,
  GoogleNotConfiguredError,
  GoogleReauthorizationRequiredError,
  RECONNECT_ONCE_MESSAGE,
  SCOPES_MISSING_MESSAGE,
  googleRedirectUri,
  type GoogleAccountIdentity,
} from "./oauth";

/** Google está disponible si hay cliente OAuth (id + secreto). */
export const isGoogleEnabled = (): boolean => googleOAuthClient() != null;

const requireClient = () => {
  const client = googleOAuthClient();
  if (!client) throw new GoogleNotConfiguredError();
  return client;
};

/**
 * URL de Google a la que mandar el navegador para dar (o renovar) el permiso.
 *
 * Google vuelve siempre a `googleRedirectUri()`; qué cuenta es, quién lo pidió
 * y a dónde volver viajan firmados en `state` (caduca en 15 min).
 */
export const startAccountAuthorization = async (input: {
  accountId: string;
  staffUserId: string;
  services: readonly GoogleService[];
  returnTo?: string;
  loginHint?: string | null;
}): Promise<string> =>
  buildAuthorizationUrl({
    client: requireClient(),
    services: input.services,
    redirectUri: googleRedirectUri(),
    state: signOAuthState({
      accountId: input.accountId,
      staffUserId: input.staffUserId,
      returnTo: input.returnTo ?? "/admin/ajustes/integraciones",
    }),
    loginHint: input.loginHint,
  });

export type CompletedAuthorization = {
  /** Ya cifrado, listo para `google_accounts.refresh_token_enc`. */
  refreshTokenEnc: string;
  grantedScopes: string[];
  identity: GoogleAccountIdentity;
  accessToken: string;
  expiresInSec: number;
};

/** Sin refresh token no hay forma de seguir usando la cuenta sin el navegador. */
export class GoogleNoRefreshTokenError extends Error {
  constructor() {
    super(
      "Google no entregó un permiso permanente (refresh token). Quita el acceso de la app en myaccount.google.com/permissions y vuelve a conectar."
    );
  }
}

/** Cambia el `code` de la vuelta de Google por los tokens y la identidad. */
export const completeAccountAuthorization = async (
  code: string
): Promise<CompletedAuthorization> => {
  const token = await exchangeAuthorizationCode({
    client: requireClient(),
    code,
    redirectUri: googleRedirectUri(),
  });
  if (!token.refresh_token) throw new GoogleNoRefreshTokenError();
  return {
    refreshTokenEnc: sealSecret(token.refresh_token),
    grantedScopes: parseGrantedScopes(token.scope),
    identity: await fetchGoogleIdentity(token.access_token),
    accessToken: token.access_token,
    expiresInSec: token.expires_in ?? 3600,
  };
};

const provider = createGoogleTokenProvider({
  client: googleOAuthClient,
  store: {
    load: (accountId) =>
      prisma.googleAccount.findUnique({
        where: { id: accountId },
        select: {
          id: true,
          isActive: true,
          services: true,
          refreshTokenEnc: true,
          grantedScopes: true,
        },
      }),
    /**
     * Mismo criterio que `lib/tiktok/oauth.ts`: un permiso revocado no es un
     * fallo pasajero, así que la fila se apaga y la UI ofrece reconectar en vez
     * de dejar al operador reintentando algo que nunca va a funcionar.
     */
    markNeedsReauthorization: async (accountId, reason) => {
      await prisma.googleAccount.update({
        where: { id: accountId },
        data: { isActive: false, lastError: reason },
      });
    },
    saveRotatedRefreshToken: async (accountId, refreshToken) => {
      await prisma.googleAccount.update({
        where: { id: accountId },
        data: { refreshTokenEnc: sealSecret(refreshToken) },
      });
    },
    open: openSecret,
  },
});

/**
 * Access token válido para una cuenta conectada.
 *
 * Solo sirve si la cuenta concedió los scopes de los servicios pedidos (por
 * defecto los suyos menos Meet, que se pide aparte).
 */
export const getAccountToken = provider.getAccountToken;

/** Olvida el token cacheado de una cuenta (tras reconectarla o borrarla). */
export const forgetAccountToken = provider.forget;

