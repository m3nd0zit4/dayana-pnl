import { authorizationServerMetadata, OAUTH_CORS_HEADERS } from "@/lib/mcp/oauth-format";
import { oauthPreflight, requestOrigin } from "@/lib/mcp/oauth-http";

/** Metadatos del servidor de autorización del MCP (RFC 8414). Ver docs/mcp.md. */

export const GET = (req: Request) =>
  Response.json(authorizationServerMetadata(requestOrigin(req)), {
    headers: { ...OAUTH_CORS_HEADERS, "Cache-Control": "public, max-age=3600" },
  });

export const OPTIONS = oauthPreflight;
