import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import {
  authenticateOAuthClient,
  exchangeAuthorizationCode,
  OAuthError,
  readClientCredentials,
  refreshAccessToken,
} from "@/lib/mcp/oauth";
import { oauthError, oauthJson, oauthPreflight, readOAuthForm, requestOrigin } from "@/lib/mcp/oauth-http";

/**
 * Token endpoint del OAuth del MCP: `authorization_code` (con PKCE) y
 * `refresh_token` (rotativo). Ver docs/mcp.md.
 */

export const runtime = "nodejs";

const REQUESTS_PER_MINUTE = 60;

export const POST = async (req: Request) => {
  const limit = await rateLimitDistributed(`mcp-oauth-token:${clientIp(req)}`, REQUESTS_PER_MINUTE, 60_000);
  if (!limit.ok) {
    return oauthJson({ error: "slow_down", error_description: "Demasiadas peticiones: espera un minuto." }, 429, { "Retry-After": "60" });
  }
  try {
    const form = await readOAuthForm(req);
    const client = await authenticateOAuthClient(readClientCredentials(req.headers.get("authorization"), form));
    const origin = requestOrigin(req);
    const grantType = form.get("grant_type");
    if (grantType === "authorization_code") {
      return oauthJson(
        await exchangeAuthorizationCode({
          client,
          code: form.get("code"),
          redirectUri: form.get("redirect_uri"),
          codeVerifier: form.get("code_verifier"),
          resource: form.get("resource"),
          origin,
        })
      );
    }
    if (grantType === "refresh_token") {
      return oauthJson(
        await refreshAccessToken({
          client,
          refreshToken: form.get("refresh_token"),
          scope: form.get("scope"),
          resource: form.get("resource"),
          origin,
        })
      );
    }
    throw new OAuthError("unsupported_grant_type", "grant_type admitidos: authorization_code, refresh_token.");
  } catch (error) {
    return oauthError(error);
  }
};

export const OPTIONS = oauthPreflight;
