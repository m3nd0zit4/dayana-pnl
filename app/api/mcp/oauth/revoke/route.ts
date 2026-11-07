import { authenticateOAuthClient, readClientCredentials, revokeOAuthToken } from "@/lib/mcp/oauth";
import { oauthError, oauthPreflight, readOAuthForm } from "@/lib/mcp/oauth-http";
import { OAUTH_CORS_HEADERS } from "@/lib/mcp/oauth-format";

/** Revocación de tokens OAuth del MCP (RFC 7009). Un refresh revoca la conexión entera. */

export const runtime = "nodejs";

export const POST = async (req: Request) => {
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
