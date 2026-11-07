import { OAUTH_CORS_HEADERS } from "./oauth-format";
import { OAuthError } from "./oauth";

/**
 * Lo común de las rutas HTTP del OAuth del MCP: de qué origen se habla (el
 * emisor y el `resource` salen de ahí) y cómo se responden los errores.
 */

type HeaderReader = { get(name: string): string | null };

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * El origen público de la petición: `X-Forwarded-Host`/`-Proto` (Vercel los
 * pone), si no `Host`, si no la URL. Es el mismo cálculo para los metadatos,
 * la pantalla de consentimiento, el token endpoint y `/api/mcp`, así que el
 * `issuer` y el `resource` siempre cuadran entre sí.
 */
export const publicOrigin = (headers: HeaderReader, fallbackUrl?: string): string => {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host"))?.split(",")[0]?.trim();
  if (host) {
    const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || (LOCAL_HOST.test(host) ? "http" : "https");
    return `${proto}://${host}`;
  }
  return fallbackUrl ? new URL(fallbackUrl).origin : "http://localhost:3000";
};

export const requestOrigin = (req: Request): string => publicOrigin(req.headers, req.url);

/** JSON sin caché (RFC 6749 §5.1) y con CORS abierto (no hay cookies en estos endpoints). */
export const oauthJson = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  Response.json(body, {
    status,
    headers: { ...OAUTH_CORS_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache", ...extra },
  });

export const oauthError = (error: unknown): Response => {
  if (error instanceof OAuthError) {
    return oauthJson(
      { error: error.error, error_description: error.description },
      error.status,
      error.status === 401 ? { "WWW-Authenticate": 'Basic realm="mcp-oauth"' } : {}
    );
  }
  console.error("[mcp-oauth] error inesperado", error);
  return oauthJson({ error: "server_error", error_description: "Error interno." }, 500);
};

export const oauthPreflight = () => new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });

/** El cuerpo de un POST OAuth: `application/x-www-form-urlencoded` (lo normal) o JSON (algunos clientes). */
export const readOAuthForm = async (req: Request): Promise<URLSearchParams> => {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body ?? {})) {
      if (typeof value === "string") form.set(key, value);
    }
    return form;
  }
  return new URLSearchParams(await req.text());
};
