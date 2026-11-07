import { withMcpAuth } from "mcp-handler";
import { rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { verifyOAuthAccessToken } from "@/lib/mcp/oauth";
import { PROTECTED_RESOURCE_METADATA_PATH } from "@/lib/mcp/oauth-format";
import { requestOrigin } from "@/lib/mcp/oauth-http";
import { authInfoFor, callerFromAuthInfo, createCrmMcpHandler } from "@/lib/mcp/server";
import { verifyMcpToken } from "@/lib/mcp/tokens";

/**
 * Servidor MCP remoto del CRM (Streamable HTTP, sin estado). Se entra con un
 * token personal `Authorization: Bearer dpnl_…` creado en /admin/ajustes/mcp o
 * con un access token OAuth `dpat_…` (claude.ai «Add custom connector» y otros
 * clientes con OAuth). Ver docs/mcp.md.
 *
 * Fuera del `matcher` de proxy.ts a propósito: aquí no hay cookie de sesión
 * que comprobar, la puerta es el token. Sin token, el 401 lleva el
 * `WWW-Authenticate` con `resource_metadata` (RFC 9728) que arranca el OAuth.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

/** Peticiones por minuto y token (cada mensaje JSON-RPC cuenta). */
const RATE_LIMIT_PER_MINUTE = 120;

const serve = async (req: Request): Promise<Response> => {
  const caller = callerFromAuthInfo(req.auth);
  if (!caller) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const limit = await rateLimitDistributed(`mcp:${caller.tokenId}`, RATE_LIMIT_PER_MINUTE, 60_000);
  if (!limit.ok) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Demasiadas peticiones: espera un minuto." } },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  return createCrmMcpHandler(caller)(req);
};

const handler = withMcpAuth(
  serve,
  async (req, bearerToken) => {
    const caller = bearerToken?.startsWith("dpat_")
      ? await verifyOAuthAccessToken(bearerToken, requestOrigin(req))
      : await verifyMcpToken(bearerToken);
    return caller && bearerToken ? authInfoFor(bearerToken, caller) : undefined;
  },
  { required: true, resourceMetadataPath: PROTECTED_RESOURCE_METADATA_PATH }
);

export { handler as GET, handler as POST, handler as DELETE };
