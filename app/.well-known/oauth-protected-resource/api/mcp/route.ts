import { OAUTH_CORS_HEADERS, protectedResourceMetadata } from "@/lib/mcp/oauth-format";
import { oauthPreflight, requestOrigin } from "@/lib/mcp/oauth-http";

/**
 * Metadatos del recurso protegido `/api/mcp` (RFC 9728). Es la URL que da el
 * `WWW-Authenticate` de los 401 de `/api/mcp`; la raíz
 * (`/.well-known/oauth-protected-resource`) responde lo mismo para los clientes
 * que la prueban primero.
 */

export const GET = (req: Request) =>
  Response.json(protectedResourceMetadata(requestOrigin(req)), {
    headers: { ...OAUTH_CORS_HEADERS, "Cache-Control": "public, max-age=3600" },
  });

export const OPTIONS = oauthPreflight;
