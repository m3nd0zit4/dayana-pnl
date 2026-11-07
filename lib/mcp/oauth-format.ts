import crypto from "node:crypto";
import { MCP_SCOPES, normalizeScopes, type McpScope } from "./scopes";

/**
 * Piezas puras del servidor OAuth 2.1 del MCP (sin base de datos, para
 * `bun test`): forma de los tokens, PKCE, validación de `redirect_uri`, scopes
 * y los metadatos que se publican en `/.well-known`.
 *
 * Ver docs/mcp.md («Conectar con OAuth») y la especificación de autorización
 * de MCP: RFC 9728 (metadatos del recurso), RFC 8414 (del servidor), RFC 7591
 * (registro dinámico), Client ID Metadata Documents, RFC 8707 (`resource`),
 * RFC 9207 (`iss` en la respuesta) y RFC 7636 (PKCE, solo S256).
 */

/** Ruta del recurso protegido. Su URL completa es el `resource` de RFC 8707. */
export const MCP_RESOURCE_PATH = "/api/mcp";
export const OAUTH_REGISTER_PATH = "/api/mcp/oauth/register";
export const OAUTH_TOKEN_PATH = "/api/mcp/oauth/token";
export const OAUTH_REVOKE_PATH = "/api/mcp/oauth/revoke";
/** La pantalla de consentimiento. Bajo /admin: el proxy pide la sesión del equipo antes. */
export const OAUTH_AUTHORIZE_PATH = "/admin/autorizar-mcp";
/** Metadatos del recurso según RFC 9728 para `/api/mcp` (con la ruta al final). */
export const PROTECTED_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`;

export const ACCESS_TOKEN_TTL_MS = 60 * 60_000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 3600_000;
export const AUTH_CODE_TTL_MS = 10 * 60_000;
/** Una conexión OAuth dura esto como mucho; después hay que volver a autorizarla. */
export const OAUTH_GRANT_TTL_MS = 90 * 24 * 3600_000;
/** Dos refrescos casi a la vez con el mismo token no son un robo: el segundo solo falla. */
export const REFRESH_REUSE_GRACE_MS = 30_000;

/** `prefix` de las conexiones OAuth en `McpAccessToken` (no hay token personal que enseñar). */
export const OAUTH_GRANT_PREFIX = "oauth";

const TOKEN_KINDS = {
  access: "dpat_",
  refresh: "dprt_",
  code: "dpac_",
  secret: "dpcs_",
} as const;
export type OAuthSecretKind = keyof typeof TOKEN_KINDS;

const RANDOM_PART = /^[A-Za-z0-9_-]{43}$/;

/** `dpat_` (acceso), `dprt_` (refresco), `dpac_` (código), `dpcs_` (secreto de cliente) + 32 bytes base64url. */
export const generateOAuthSecret = (kind: OAuthSecretKind): string =>
  `${TOKEN_KINDS[kind]}${crypto.randomBytes(32).toString("base64url")}`;

export const looksLikeOAuthSecret = (kind: OAuthSecretKind, value: unknown): value is string =>
  typeof value === "string" && value.startsWith(TOKEN_KINDS[kind]) && RANDOM_PART.test(value.slice(5));

export const hashOAuthSecret = (value: string): string =>
  crypto.createHash("sha256").update(value, "utf8").digest("hex");

export const generateClientId = (): string => `dpcl_${crypto.randomBytes(16).toString("base64url")}`;

/** Comparación en tiempo constante de dos hashes hex. */
export const sameHash = (a: string, b: string): boolean =>
  a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ── PKCE (RFC 7636): solo S256 ───────────────────────────────────────────────

const PKCE_VALUE = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export const isCodeChallenge = (value: unknown): value is string => typeof value === "string" && CHALLENGE.test(value);

export const pkceChallengeFor = (verifier: string): string =>
  crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");

export const verifyPkce = (verifier: unknown, challenge: string): boolean =>
  typeof verifier === "string" && PKCE_VALUE.test(verifier) && sameHash(pkceChallengeFor(verifier), challenge);

// ── redirect_uri ─────────────────────────────────────────────────────────────

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "ftp:", "ws:", "wss:"]);

/**
 * Un `redirect_uri` que se puede registrar: https sin fragmento, http solo a
 * loopback (Claude Code, Cursor y otros clientes de escritorio abren un puerto
 * local), o un esquema propio de aplicación (`cursor://…`, RFC 8252). Nunca
 * `javascript:`, `data:`, `file:`… ni credenciales en la URL.
 */
export const isAllowedRedirectUri = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return Boolean(url.hostname);
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return false;
  // Esquema propio: `app.ejemplo:/callback` o `cursor://…`.
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
};

/**
 * ¿`requested` es uno de los registrados? Coincidencia exacta, salvo el puerto
 * de loopback, que RFC 8252 §7.3 deja variar (el cliente lo elige al arrancar).
 */
export const redirectUriMatches = (requested: string, registered: readonly string[]): boolean => {
  if (registered.includes(requested)) return true;
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  if (req.protocol !== "http:" || !LOOPBACK_HOSTS.has(req.hostname)) return false;
  return registered.some((candidate) => {
    try {
      const reg = new URL(candidate);
      return (
        reg.protocol === "http:" &&
        reg.hostname === req.hostname &&
        reg.pathname === req.pathname &&
        reg.search === req.search
      );
    } catch {
      return false;
    }
  });
};

/** Hosts que se reconocen en la pantalla de consentimiento (el resto sale como «no verificado»). */
const KNOWN_REDIRECT_HOSTS: Record<string, string> = {
  "claude.ai": "Claude",
  "claude.com": "Claude",
  "chatgpt.com": "ChatGPT",
  "chat.openai.com": "ChatGPT",
};

/** Lo que la persona ve como destino: el host, o «esta computadora» para loopback. */
export const describeRedirect = (redirectUri: string): { label: string; known: string | null; local: boolean } => {
  try {
    const url = new URL(redirectUri);
    if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) {
      return { label: "una aplicación de esta computadora", known: null, local: true };
    }
    if (url.protocol !== "https:") return { label: `la aplicación ${url.protocol.slice(0, -1)}`, known: null, local: true };
    return { label: url.hostname, known: KNOWN_REDIRECT_HOSTS[url.hostname] ?? null, local: false };
  } catch {
    return { label: redirectUri, known: null, local: false };
  }
};

// ── scopes ───────────────────────────────────────────────────────────────────

/**
 * `scope` de OAuth (separado por espacios) → los nuestros. Lo desconocido
 * (`openid`, `offline_access`…) se ignora; sin nada válido, null = «lo que
 * permita el rol».
 */
export const parseScopeParam = (value: unknown): McpScope[] | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const scopes = normalizeScopes(value.trim().split(/\s+/));
  return scopes.length ? scopes : null;
};

export const formatScopes = (scopes: readonly McpScope[]): string => scopes.join(" ");

// ── URLs ─────────────────────────────────────────────────────────────────────

/** `https://host` (sin barra final) → el `resource` canónico del MCP. */
export const mcpResourceUrl = (origin: string): string => `${origin.replace(/\/$/, "")}${MCP_RESOURCE_PATH}`;

/**
 * ¿El `resource` pedido es este servidor? Se acepta con o sin barra final y
 * el origen solo (algunos clientes mandan el origen).
 */
export const resourceMatches = (requested: string, origin: string): boolean => {
  const canonical = mcpResourceUrl(origin);
  const clean = requested.replace(/\/$/, "");
  return clean === canonical || clean === origin.replace(/\/$/, "");
};

/** `?error=…` (o `?code=…`) para devolver a la persona al cliente, con `state` e `iss` (RFC 9207). */
export const redirectWith = (redirectUri: string, params: Record<string, string | undefined>): string => {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
};

// ── metadatos publicados ─────────────────────────────────────────────────────

/** RFC 8414. El emisor es el origen del sitio (sin ruta). */
export const authorizationServerMetadata = (origin: string) => ({
  issuer: origin,
  authorization_endpoint: `${origin}${OAUTH_AUTHORIZE_PATH}`,
  token_endpoint: `${origin}${OAUTH_TOKEN_PATH}`,
  registration_endpoint: `${origin}${OAUTH_REGISTER_PATH}`,
  revocation_endpoint: `${origin}${OAUTH_REVOKE_PATH}`,
  scopes_supported: [...MCP_SCOPES],
  response_types_supported: ["code"],
  response_modes_supported: ["query"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
  revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
  authorization_response_iss_parameter_supported: true,
  client_id_metadata_document_supported: true,
});

/** RFC 9728 para `/api/mcp`. */
export const protectedResourceMetadata = (origin: string) => ({
  resource: mcpResourceUrl(origin),
  authorization_servers: [origin],
  scopes_supported: [...MCP_SCOPES],
  bearer_methods_supported: ["header"],
  resource_name: "CRM de Dayana Beltrán PNL",
});

// ── clientes ─────────────────────────────────────────────────────────────────

export const CLIENT_AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;
export type ClientAuthMethod = (typeof CLIENT_AUTH_METHODS)[number];
const MAX_REDIRECT_URIS = 10;

export type ClientMetadata = {
  name: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: ClientAuthMethod;
  clientUri: string | null;
  logoUri: string | null;
};

export type ParsedClient = { ok: true; client: ClientMetadata } | { ok: false; error: string; description: string };

const optionalHttpsUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
};

const cleanName = (value: unknown): string => {
  const name = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
  return name ? name.slice(0, 80) : "Cliente MCP";
};

/**
 * Cuerpo de `POST /register` (RFC 7591) → lo que se guarda, o el error de la
 * RFC. Solo `authorization_code` + `refresh_token` y `response_type=code`; el
 * método por defecto es `client_secret_basic`, como dice la RFC.
 */
export const parseRegistrationRequest = (body: unknown): ParsedClient => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_client_metadata", description: "El cuerpo tiene que ser un objeto JSON." };
  }
  const meta = body as Record<string, unknown>;
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return { ok: false, error: "invalid_redirect_uri", description: `Hacen falta de 1 a ${MAX_REDIRECT_URIS} redirect_uris.` };
  }
  if (!uris.every(isAllowedRedirectUri)) {
    return {
      ok: false,
      error: "invalid_redirect_uri",
      description: "Cada redirect_uri tiene que ser https, http a localhost o un esquema propio de aplicación, sin fragmento.",
    };
  }
  const method = meta.token_endpoint_auth_method ?? "client_secret_basic";
  if (!(CLIENT_AUTH_METHODS as readonly unknown[]).includes(method)) {
    return {
      ok: false,
      error: "invalid_client_metadata",
      description: `token_endpoint_auth_method admitidos: ${CLIENT_AUTH_METHODS.join(", ")}.`,
    };
  }
  const grantTypes = meta.grant_types ?? ["authorization_code"];
  if (!Array.isArray(grantTypes) || !grantTypes.every((g) => g === "authorization_code" || g === "refresh_token")) {
    return { ok: false, error: "invalid_client_metadata", description: "grant_types admitidos: authorization_code, refresh_token." };
  }
  const responseTypes = meta.response_types ?? ["code"];
  if (!Array.isArray(responseTypes) || !responseTypes.every((r) => r === "code")) {
    return { ok: false, error: "invalid_client_metadata", description: "Solo response_type=code." };
  }
  return {
    ok: true,
    client: {
      name: cleanName(meta.client_name),
      redirectUris: [...new Set(uris as string[])],
      tokenEndpointAuthMethod: method as ClientAuthMethod,
      clientUri: optionalHttpsUrl(meta.client_uri),
      logoUri: optionalHttpsUrl(meta.logo_uri),
    },
  };
};

/**
 * ¿Se puede usar esta URL como `client_id` de un documento de metadatos (CIMD)?
 * https, con ruta, sin fragmento ni credenciales, y nunca a una IP, localhost
 * o un nombre interno: la descarga la hace nuestro servidor.
 */
export const isClientMetadataUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.pathname === "/" || url.hash || url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.startsWith("[") || /^[\d.]+$/.test(host)) return false;
  return !/(^|\.)(localhost|local|internal|intranet|lan|home|corp|arpa)$/.test(host);
};

/**
 * El documento de metadatos de un cliente CIMD → lo que se guarda. Su
 * `client_id` tiene que ser exactamente la URL de la que se bajó, y como es un
 * cliente público (nadie le dio un secreto) solo vale `none`.
 */
export const parseClientMetadataDocument = (url: string, doc: unknown): ParsedClient => {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, error: "invalid_client", description: "El documento del cliente no es un objeto JSON." };
  }
  const meta = doc as Record<string, unknown>;
  if (meta.client_id !== url) {
    return { ok: false, error: "invalid_client", description: "El client_id del documento no coincide con su URL." };
  }
  const method = meta.token_endpoint_auth_method ?? "none";
  if (method !== "none") {
    return { ok: false, error: "invalid_client", description: "Solo se admiten clientes públicos (token_endpoint_auth_method=none)." };
  }
  const parsed = parseRegistrationRequest({ ...meta, token_endpoint_auth_method: "none" });
  if (!parsed.ok) return { ok: false, error: "invalid_client", description: parsed.description };
  return parsed;
};

/** Cabeceras para los endpoints que pueden llamar clientes desde un navegador (sin cookies). */
export const OAUTH_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};
