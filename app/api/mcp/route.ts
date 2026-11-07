import { withMcpAuth } from "mcp-handler";
import { rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { authInfoFor, callerFromAuthInfo, createCrmMcpHandler } from "@/lib/mcp/server";
import { verifyMcpToken } from "@/lib/mcp/tokens";

/**
 * Servidor MCP remoto del CRM (Streamable HTTP, sin estado). Cualquier cliente
 * MCP entra con un token personal `Authorization: Bearer dpnl_…` creado en
 * /admin/ajustes/mcp. Ver docs/mcp.md.
 *
 * Fuera del `matcher` de proxy.ts a propósito: aquí no hay cookie de sesión
 * que comprobar, la puerta es el token.
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
  async (_req, bearerToken) => {
    const caller = await verifyMcpToken(bearerToken);
    return caller && bearerToken ? authInfoFor(bearerToken, caller) : undefined;
  },
  { required: true }
);

export { handler as GET, handler as POST, handler as DELETE };
