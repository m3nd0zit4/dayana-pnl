import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { authenticateOAuthClient, readClientCredentials, revokeOAuthToken } from "@/lib/mcp/oauth";
import { oauthError, oauthJson, oauthPreflight, readOAuthForm } from "@/lib/mcp/oauth-http";
import { OAUTH_CORS_HEADERS } from "@/lib/mcp/oauth-format";

/** Revocación de tokens OAuth del MCP (RFC 7009). Un refresh revoca la conexión entera. */

export const runtime = "nodejs";

const REQUESTS_PER_MINUTE = 60;

export const POST = async (req: Request) => {
  const limit = await rateLimitDistributed(`mcp-oauth-revoke:${clientIp(req)}`, REQUESTS_PER_MINUTE, 60_000);
  if (!limit.ok) {
    return oauthJson({ error: "slow_down", error_description: "Demasiadas peticiones: espera un minuto." }, 429, { "Retry-After": "60" });
  }
  try {
    const form = await readOAuthForm(req);
    const client = await authenticateOAuthClient(readClientCredentials(req.headers.get("authorization"), form));
    await revokeOAuthToken(client, form.get("token"));
    return new Response(null, { status: 200, headers: { ...OAUTH_CORS_HEADERS, "Cache-Control": "no-store" } });
  } catch (error) {
    return oauthError(error);
  }
};

export const OPTIONS = oauthPreflight;
