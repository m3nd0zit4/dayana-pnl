import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { registerOAuthClient } from "@/lib/mcp/oauth";
import { oauthError, oauthJson, oauthPreflight } from "@/lib/mcp/oauth-http";

/**
 * Registro dinámico de clientes OAuth del MCP (RFC 7591). Abierto, como pide la
 * especificación de MCP: un cliente registrado no puede hacer nada hasta que
 * alguien del equipo inicie sesión y lo autorice. Ver docs/mcp.md.
 */

export const runtime = "nodejs";

/** Registros por hora e IP. claude.ai registra una vez por conector. */
const REGISTRATIONS_PER_HOUR = 20;

export const POST = async (req: Request) => {
  const limit = await rateLimitDistributed(`mcp-oauth-register:${clientIp(req)}`, REGISTRATIONS_PER_HOUR, 3600_000);
  if (!limit.ok) {
    return oauthJson({ error: "slow_down", error_description: "Demasiados registros: espera una hora." }, 429, { "Retry-After": "3600" });
  }
  const body = await req.json().catch(() => null);
  try {
    return oauthJson(await registerOAuthClient(body), 201);
  } catch (error) {
    return oauthError(error);
  }
};

export const OPTIONS = oauthPreflight;
