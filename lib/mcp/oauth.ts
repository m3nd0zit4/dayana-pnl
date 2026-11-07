import { lookup } from "node:dns/promises";
import type { StaffRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/crm/audit";
import {
  ACCESS_TOKEN_TTL_MS,
  AUTH_CODE_TTL_MS,
  describeRedirect,
  formatScopes,
  generateClientId,
  generateOAuthSecret,
  hashOAuthSecret,
  isClientMetadataUrl,
  isCodeChallenge,
  looksLikeOAuthSecret,
  mcpResourceUrl,
  OAUTH_GRANT_PREFIX,
  OAUTH_GRANT_TTL_MS,
  parseClientMetadataDocument,
  parseRegistrationRequest,
  parseScopeParam,
  redirectUriMatches,
  redirectWith,
  REFRESH_REUSE_GRACE_MS,
  REFRESH_TOKEN_TTL_MS,
  resourceMatches,
  sameHash,
  verifyPkce,
  type ClientAuthMethod,
} from "./oauth-format";
import { effectiveScopes, intersectScopes, roleScopes, type McpScope } from "./scopes";
import { MAX_ACTIVE_TOKENS_PER_STAFF, type McpCaller } from "./tokens";
import { LAST_USED_THROTTLE_MS } from "./token-format";

/**
 * Servidor de autorización OAuth 2.1 del MCP (para «Add custom connector» de
 * claude.ai y cualquier cliente MCP con OAuth). Lo puro está en
 * `oauth-format.ts`; aquí va lo que toca la base.
 *
 * Una autorización crea una **conexión**: una fila `McpAccessToken` con
 * `oauthClientId`, la misma tabla que los tokens personales. Por eso se ve, se
 * revoca y se audita igual en `/admin/ajustes/mcp`, y por eso los scopes se
 * recalculan en cada petición contra el rol de hoy.
 */

export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400
  ) {
    super(description);
  }
}

export type OAuthClientRow = {
  id: string;
  name: string;
  secretHash: string | null;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
  clientUri: string | null;
  source: string;
};

const CLIENT_SELECT = {
  id: true,
  name: true,
  secretHash: true,
  redirectUris: true,
  tokenEndpointAuthMethod: true,
  clientUri: true,
  source: true,
  metadataFetchedAt: true,
} as const;

// ── registro y clientes ──────────────────────────────────────────────────────

export type RegistrationResponse = {
  client_id: string;
  client_id_issued_at: number;
  client_secret?: string;
  client_secret_expires_at?: number;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: ClientAuthMethod;
  grant_types: string[];
  response_types: string[];
  scope: string;
};

/** `POST /register` (RFC 7591). Abierto, como pide MCP: registrarse no da acceso a nada. */
export const registerOAuthClient = async (body: unknown): Promise<RegistrationResponse> => {
  const parsed = parseRegistrationRequest(body);
  if (!parsed.ok) throw new OAuthError(parsed.error, parsed.description);
  const { client } = parsed;
  const secret = client.tokenEndpointAuthMethod === "none" ? null : generateOAuthSecret("secret");
  const row = await prisma.mcpOAuthClient.create({
    data: {
      id: generateClientId(),
      name: client.name,
      secretHash: secret ? hashOAuthSecret(secret) : null,
      redirectUris: client.redirectUris,
      tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
      clientUri: client.clientUri,
      logoUri: client.logoUri,
      source: "dcr",
    },
  });
  await writeAuditLog({
    action: "MCP_OAUTH_CLIENT_REGISTERED",
    entityType: "McpOAuthClient",
    entityId: row.id,
    changes: {
      name: row.name,
      redirectUris: row.redirectUris,
      tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
    },
  }).catch(() => undefined);
  return {
    client_id: row.id,
    client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: row.name,
    redirect_uris: row.redirectUris,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "read edit execute",
  };
};

/** Un documento CIMD se vuelve a leer como mucho una vez por hora. */
const CIMD_REFRESH_MS = 60 * 60_000;
const CIMD_MAX_BYTES = 20_000;
const CIMD_TIMEOUT_MS = 5_000;

/** Solo para las pruebas: el documento CIMD sin red. */
let cimdFetchForTests: typeof fetch | null = null;
export const setCimdFetchForTests = (fn: typeof fetch | null) => {
  cimdFetchForTests = fn;
};

/**
 * True for addresses a public client document can never live on: loopback,
 * private, link-local, CGNAT, unique-local, unspecified. Pure (tested).
 */
export const isPrivateAddress = (address: string): boolean => {
  const ip = address.toLowerCase().replace(/^::ffff:/, "");
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
    );
  }
  return ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80");
};

/** The document's host must resolve only to public addresses (no fetches into our own network). */
const assertPublicHost = async (url: string) => {
  if (cimdFetchForTests) return;
  const records = await lookup(new URL(url).hostname, { all: true }).catch(() => []);
  if (records.length === 0 || records.some((r) => isPrivateAddress(r.address))) {
    throw new OAuthError("invalid_client", "El documento del cliente no está en una dirección pública.");
  }
};

const fetchClientMetadataDocument = async (url: string): Promise<unknown> => {
  await assertPublicHost(url);
  const res = await (cimdFetchForTests ?? fetch)(url, {
    redirect: "error",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
  });
  if (!res.ok) throw new OAuthError("invalid_client", `El documento del cliente respondió ${res.status}.`);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > CIMD_MAX_BYTES) throw new OAuthError("invalid_client", "El documento del cliente es demasiado grande.");
  const text = await res.text();
  if (text.length > CIMD_MAX_BYTES) throw new OAuthError("invalid_client", "El documento del cliente es demasiado grande.");
  try {
    return JSON.parse(text);
  } catch {
    throw new OAuthError("invalid_client", "El documento del cliente no es JSON.");
  }
};

/**
 * `client_id` → el cliente. Los registrados salen de la base; una URL https es
 * un Client ID Metadata Document: se baja (sin seguir redirecciones, 5 s, 20 KB)
 * y se guarda una hora. null si no existe o el documento no vale.
 */
export const resolveOAuthClient = async (
  clientId: unknown,
  now = new Date(),
  /**
   * `false` on the token and revoke endpoints: they never fetch a document or
   * write a client row (anyone can call them). A metadata-document client
   * always goes through the consent screen first, which stores it.
   */
  options: { fetchMetadata?: boolean } = {}
): Promise<OAuthClientRow | null> => {
  if (typeof clientId !== "string" || !clientId || clientId.length > 2000) return null;
  const existing = await prisma.mcpOAuthClient.findUnique({ where: { id: clientId }, select: CLIENT_SELECT });
  if (existing && existing.source === "dcr") return existing;
  if (!isClientMetadataUrl(clientId) || options.fetchMetadata === false) return existing;
  if (existing?.metadataFetchedAt && now.getTime() - existing.metadataFetchedAt.getTime() < CIMD_REFRESH_MS) {
    return existing;
  }
  let doc: unknown;
  try {
    doc = await fetchClientMetadataDocument(clientId);
  } catch (error) {
    console.warn("[mcp-oauth] no se pudo leer el documento del cliente", clientId, error instanceof Error ? error.message : error);
    return null;
  }
  const parsed = parseClientMetadataDocument(clientId, doc);
  if (!parsed.ok) {
    console.warn("[mcp-oauth] documento de cliente inválido", clientId, parsed.description);
    return null;
  }
  const data = {
    name: parsed.client.name,
    redirectUris: parsed.client.redirectUris,
    tokenEndpointAuthMethod: "none",
    clientUri: parsed.client.clientUri,
    logoUri: parsed.client.logoUri,
    secretHash: null,
    source: "cimd",
    metadataFetchedAt: now,
  };
  return prisma.mcpOAuthClient.upsert({
    where: { id: clientId },
    create: { id: clientId, ...data },
    update: data,
    select: CLIENT_SELECT,
  });
};

/** Credenciales que trae una petición al token endpoint (cabecera Basic o cuerpo). */
export type ClientCredentials = { clientId: string | null; clientSecret: string | null; method: ClientAuthMethod };

export const readClientCredentials = (authorization: string | null, form: URLSearchParams): ClientCredentials => {
  if (authorization?.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon > 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, colon)),
          clientSecret: decodeURIComponent(decoded.slice(colon + 1)),
          method: "client_secret_basic",
        };
      }
    } catch {
      // cae a las credenciales del cuerpo
    }
  }
  const secret = form.get("client_secret");
  return {
    clientId: form.get("client_id"),
    clientSecret: secret,
    method: secret ? "client_secret_post" : "none",
  };
};

/** El cliente que llama al token/revoke endpoint, autenticado según cómo se registró. */
export const authenticateOAuthClient = async (credentials: ClientCredentials): Promise<OAuthClientRow> => {
  const client = await resolveOAuthClient(credentials.clientId, new Date(), { fetchMetadata: false });
  if (!client) throw new OAuthError("invalid_client", "Cliente desconocido.", 401);
  if (client.secretHash) {
    if (!credentials.clientSecret || !sameHash(hashOAuthSecret(credentials.clientSecret), client.secretHash)) {
      throw new OAuthError("invalid_client", "Credenciales del cliente incorrectas.", 401);
    }
  } else if (credentials.clientSecret) {
    throw new OAuthError("invalid_client", "Este cliente es público: no lleva secreto.", 401);
  }
  return client;
};

// ── petición de autorización ─────────────────────────────────────────────────

export type AuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  /** Lo pedido (ya filtrado a read/edit/execute) o null = lo que permita el rol. */
  scopes: McpScope[] | null;
  state: string | undefined;
  resource: string;
};

export type AuthorizationCheck =
  /** No se sabe a dónde volver: se enseña el error y nunca se redirige. */
  | { kind: "fatal"; message: string }
  /** Cliente y redirect_uri válidos pero la petición no: se vuelve al cliente con `error`. */
  | { kind: "redirect"; url: string }
  | { kind: "ok"; client: OAuthClientRow; request: AuthorizationRequest };

type Params = { get(name: string): string | null };

/**
 * Valida una petición de autorización (GET de la pantalla y POST del
 * consentimiento, siempre las dos). Primero el cliente y la `redirect_uri`
 * —si fallan no se redirige a ningún sitio—, después lo demás.
 */
export const checkAuthorizationRequest = async (params: Params, origin: string): Promise<AuthorizationCheck> => {
  const clientId = params.get("client_id");
  const client = await resolveOAuthClient(clientId);
  if (!client) return { kind: "fatal", message: "La aplicación que te mandó aquí no está registrada o su ficha no se pudo leer." };
  const redirectUri = params.get("redirect_uri") ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
  if (!redirectUri || !redirectUriMatches(redirectUri, client.redirectUris)) {
    return { kind: "fatal", message: "La dirección de vuelta no coincide con la que registró la aplicación." };
  }
  const state = params.get("state") ?? undefined;
  const fail = (error: string, description: string): AuthorizationCheck => ({
    kind: "redirect",
    url: redirectWith(redirectUri, { error, error_description: description, state, iss: origin }),
  });
  if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Solo response_type=code.");
  const codeChallenge = params.get("code_challenge");
  if (!isCodeChallenge(codeChallenge) || params.get("code_challenge_method") !== "S256") {
    return fail("invalid_request", "PKCE es obligatorio (code_challenge con code_challenge_method=S256).");
  }
  const requestedResource = params.get("resource");
  if (requestedResource && !resourceMatches(requestedResource, origin)) {
    return fail("invalid_target", "Este servidor de autorización solo emite tokens para su propio /api/mcp.");
  }
  return {
    kind: "ok",
    client,
    request: {
      clientId: client.id,
      redirectUri,
      codeChallenge,
      scopes: parseScopeParam(params.get("scope")),
      state,
      resource: mcpResourceUrl(origin),
    },
  };
};

/** Lo que se le ofrece a esta persona: lo pedido ∩ su rol (o todo su rol si no pidió nada). */
export const offeredScopes = (request: AuthorizationRequest, role: StaffRole): McpScope[] =>
  request.scopes ? intersectScopes(request.scopes, roleScopes(role)) : roleScopes(role);

const activeGrantWhere = (now: Date) => ({
  revokedAt: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

/**
 * «Permitir»: emite el código (10 min, un uso, atado al PKCE, a la
 * `redirect_uri` y a la persona) y devuelve a dónde mandar el navegador.
 * `chosen` son las casillas marcadas: nunca más de lo ofrecido.
 */
export const approveAuthorization = async (input: {
  staff: { id: string; role: StaffRole };
  client: OAuthClientRow;
  request: AuthorizationRequest;
  chosen: readonly unknown[];
  origin: string;
  now?: Date;
}): Promise<string> => {
  const now = input.now ?? new Date();
  const { request } = input;
  const scopes = intersectScopes(input.chosen, offeredScopes(request, input.staff.role));
  if (scopes.length === 0) {
    return redirectWith(request.redirectUri, {
      error: "access_denied",
      error_description: "No se eligió ningún permiso.",
      state: request.state,
      iss: input.origin,
    });
  }
  // La conexión anterior de este mismo cliente se reemplaza al canjear, así que no cuenta.
  const active = await prisma.mcpAccessToken.count({
    where: { staffUserId: input.staff.id, ...activeGrantWhere(now), NOT: { oauthClientId: input.client.id } },
  });
  if (active >= MAX_ACTIVE_TOKENS_PER_STAFF) {
    return redirectWith(request.redirectUri, {
      error: "access_denied",
      error_description: `Ya tienes ${active} conexiones activas. Revoca alguna en Ajustes → Conexiones MCP.`,
      state: request.state,
      iss: input.origin,
    });
  }
  const code = generateOAuthSecret("code");
  await prisma.mcpOAuthCode.create({
    data: {
      codeHash: hashOAuthSecret(code),
      clientId: input.client.id,
      staffUserId: input.staff.id,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      scopes,
      resource: request.resource,
      expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_MS),
    },
  });
  // Los códigos caducados no sirven para nada: se barren al emitir uno nuevo.
  await prisma.mcpOAuthCode
    .deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 3600_000) } } })
    .catch(() => undefined);
  return redirectWith(request.redirectUri, { code, state: request.state, iss: input.origin });
};

export const denyAuthorization = (request: AuthorizationRequest, origin: string): string =>
  redirectWith(request.redirectUri, {
    error: "access_denied",
    error_description: "La persona no autorizó la conexión.",
    state: request.state,
    iss: origin,
  });

// ── token endpoint ───────────────────────────────────────────────────────────

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

const issueTokens = async (grantId: string, scopes: McpScope[], grantExpiresAt: Date | null, now: Date): Promise<TokenResponse> => {
  const access = generateOAuthSecret("access");
  const refresh = generateOAuthSecret("refresh");
  const cap = (ms: number) => new Date(Math.min(now.getTime() + ms, grantExpiresAt?.getTime() ?? Infinity));
  const accessExpiresAt = cap(ACCESS_TOKEN_TTL_MS);
  await prisma.mcpOAuthToken.createMany({
    data: [
      { grantId, kind: "access", tokenHash: hashOAuthSecret(access), expiresAt: accessExpiresAt },
      { grantId, kind: "refresh", tokenHash: hashOAuthSecret(refresh), expiresAt: cap(REFRESH_TOKEN_TTL_MS) },
    ],
  });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.max(1, Math.floor((accessExpiresAt.getTime() - now.getTime()) / 1000)),
    refresh_token: refresh,
    scope: formatScopes(scopes),
  };
};

/** Corta una conexión OAuth por un motivo del propio protocolo (código o refresh repetido, reemplazo). */
const revokeGrant = async (grantId: string, reason: string, now: Date) => {
  const grant = await prisma.mcpAccessToken.updateManyAndReturn({
    where: { id: grantId, revokedAt: null },
    data: { revokedAt: now },
    select: { id: true, name: true, staffUserId: true, oauthClientId: true },
  });
  await prisma.mcpOAuthToken.updateMany({ where: { grantId, revokedAt: null }, data: { revokedAt: now } });
  for (const row of grant) {
    await writeAuditLog({
      staffUserId: row.staffUserId,
      action: "MCP_TOKEN_REVOKED",
      entityType: "McpAccessToken",
      entityId: row.id,
      changes: { name: row.name, prefix: OAUTH_GRANT_PREFIX, via: "oauth", oauthClientId: row.oauthClientId, reason },
    }).catch(() => undefined);
  }
};

const invalidGrant = (description: string) => new OAuthError("invalid_grant", description);

/** `grant_type=authorization_code`: canjea el código (PKCE) y crea la conexión. */
export const exchangeAuthorizationCode = async (input: {
  client: OAuthClientRow;
  code: string | null;
  redirectUri: string | null;
  codeVerifier: string | null;
  resource: string | null;
  origin: string;
  now?: Date;
}): Promise<TokenResponse> => {
  const now = input.now ?? new Date();
  if (!looksLikeOAuthSecret("code", input.code)) throw invalidGrant("Código inválido.");
  const row = await prisma.mcpOAuthCode.findUnique({
    where: { codeHash: hashOAuthSecret(input.code) },
    include: { staffUser: { select: { id: true, role: true, isActive: true, displayName: true } } },
  });
  if (!row || row.clientId !== input.client.id) throw invalidGrant("Código inválido.");
  if (row.usedAt) {
    // OAuth 2.1 §4.1.3: un código repetido es un robo probable → se revoca lo que emitió.
    if (row.grantId) await revokeGrant(row.grantId, "code_reuse", now);
    throw invalidGrant("Ese código ya se usó.");
  }
  if (row.expiresAt.getTime() <= now.getTime()) throw invalidGrant("El código caducó.");
  if (input.redirectUri !== row.redirectUri) throw invalidGrant("redirect_uri no coincide con la de la autorización.");
  if (!verifyPkce(input.codeVerifier, row.codeChallenge)) throw invalidGrant("code_verifier no coincide (PKCE).");
  if (input.resource && !resourceMatches(input.resource, input.origin)) {
    throw new OAuthError("invalid_target", "Este servidor solo emite tokens para su propio /api/mcp.");
  }
  const claimed = await prisma.mcpOAuthCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  if (claimed.count !== 1) throw invalidGrant("Ese código ya se usó.");

  const staff = row.staffUser;
  const scopes = effectiveScopes(row.scopes, staff.role);
  if (!staff.isActive || scopes.length === 0) throw invalidGrant("La cuenta ya no tiene acceso por MCP.");

  // Volver a autorizar el mismo cliente reemplaza la conexión anterior (no se acumulan).
  const previous = await prisma.mcpAccessToken.findMany({
    where: { staffUserId: staff.id, oauthClientId: input.client.id, ...activeGrantWhere(now) },
    select: { id: true },
  });
  for (const p of previous) await revokeGrant(p.id, "replaced", now);

  const grant = await prisma.mcpAccessToken.create({
    data: {
      staffUserId: staff.id,
      name: input.client.name,
      tokenHash: null,
      prefix: OAUTH_GRANT_PREFIX,
      scopes,
      expiresAt: new Date(now.getTime() + OAUTH_GRANT_TTL_MS),
      oauthClientId: input.client.id,
      resource: row.resource,
    },
  });
  await prisma.mcpOAuthCode.update({ where: { id: row.id }, data: { grantId: grant.id } });
  await prisma.mcpOAuthClient.update({ where: { id: input.client.id }, data: { lastUsedAt: now } }).catch(() => undefined);
  await writeAuditLog({
    staffUserId: staff.id,
    action: "MCP_TOKEN_CREATED",
    entityType: "McpAccessToken",
    entityId: grant.id,
    changes: {
      name: grant.name,
      prefix: OAUTH_GRANT_PREFIX,
      scopes,
      expiresAt: grant.expiresAt?.toISOString() ?? null,
      via: "oauth",
      oauthClientId: input.client.id,
      clientSource: input.client.source,
      redirectHost: describeRedirect(row.redirectUri).label,
      ...(previous.length ? { replaced: previous.map((p) => p.id) } : {}),
    },
  });
  return issueTokens(grant.id, scopes, grant.expiresAt, now);
};

/**
 * `grant_type=refresh_token`: rota el refresh (el viejo deja de valer) y da un
 * acceso nuevo. Un refresh ya rotado que vuelve a aparecer —pasados 30 s, para
 * no castigar dos refrescos simultáneos— revoca la conexión entera.
 */
export const refreshAccessToken = async (input: {
  client: OAuthClientRow;
  refreshToken: string | null;
  scope: string | null;
  resource: string | null;
  origin: string;
  now?: Date;
}): Promise<TokenResponse> => {
  const now = input.now ?? new Date();
  if (!looksLikeOAuthSecret("refresh", input.refreshToken)) throw invalidGrant("Refresh token inválido.");
  const row = await prisma.mcpOAuthToken.findUnique({
    where: { tokenHash: hashOAuthSecret(input.refreshToken) },
    include: {
      grant: {
        select: {
          id: true,
          scopes: true,
          expiresAt: true,
          revokedAt: true,
          oauthClientId: true,
          staffUser: { select: { role: true, isActive: true } },
        },
      },
    },
  });
  if (!row || row.kind !== "refresh" || row.grant.oauthClientId !== input.client.id) throw invalidGrant("Refresh token inválido.");
  if (row.rotatedAt) {
    if (now.getTime() - row.rotatedAt.getTime() > REFRESH_REUSE_GRACE_MS) await revokeGrant(row.grantId, "refresh_reuse", now);
    throw invalidGrant("Ese refresh token ya se usó.");
  }
  const grant = row.grant;
  if (row.revokedAt || row.expiresAt.getTime() <= now.getTime()) throw invalidGrant("El refresh token caducó o se revocó.");
  if (grant.revokedAt || (grant.expiresAt && grant.expiresAt.getTime() <= now.getTime())) {
    throw invalidGrant("La conexión se revocó o caducó: vuelve a autorizarla.");
  }
  if (input.resource && !resourceMatches(input.resource, input.origin)) {
    throw new OAuthError("invalid_target", "Este servidor solo emite tokens para su propio /api/mcp.");
  }
  let scopes = effectiveScopes(grant.scopes, grant.staffUser.role);
  if (!grant.staffUser.isActive || scopes.length === 0) throw invalidGrant("La cuenta ya no tiene acceso por MCP.");
  const narrowed = parseScopeParam(input.scope);
  if (narrowed) {
    scopes = intersectScopes(narrowed, scopes);
    if (scopes.length === 0) throw new OAuthError("invalid_scope", "Esos permisos no están en la conexión.");
  }
  const claimed = await prisma.mcpOAuthToken.updateMany({ where: { id: row.id, rotatedAt: null }, data: { rotatedAt: now } });
  if (claimed.count !== 1) throw invalidGrant("Ese refresh token ya se usó.");
  // Los tokens viejos de la conexión ya no sirven: fuera los caducados.
  await prisma.mcpOAuthToken
    .deleteMany({ where: { grantId: grant.id, expiresAt: { lt: new Date(now.getTime() - 24 * 3600_000) } } })
    .catch(() => undefined);
  return issueTokens(grant.id, scopes, grant.expiresAt, now);
};

/**
 * RFC 7009. Un refresh revoca la conexión entera; un acceso, solo ese token.
 * Responde igual exista o no (no se le dice a nadie qué tokens existen).
 */
export const revokeOAuthToken = async (client: OAuthClientRow, token: string | null, now = new Date()) => {
  const kind = looksLikeOAuthSecret("refresh", token) ? "refresh" : looksLikeOAuthSecret("access", token) ? "access" : null;
  if (!kind || !token) return;
  const row = await prisma.mcpOAuthToken.findUnique({
    where: { tokenHash: hashOAuthSecret(token) },
    select: { id: true, grantId: true, grant: { select: { oauthClientId: true } } },
  });
  if (!row || row.grant.oauthClientId !== client.id) return;
  if (kind === "refresh") await revokeGrant(row.grantId, "client_revocation", now);
  else await prisma.mcpOAuthToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: now } });
};

// ── verificación en /api/mcp ─────────────────────────────────────────────────

/**
 * Un access token OAuth → quién llama, o null. Igual que `verifyMcpToken`:
 * conexión viva, persona activa, scopes ∩ rol de HOY; además el token tiene que
 * ser para este recurso (RFC 8707: `resource` de la conexión = este `/api/mcp`).
 */
export const verifyOAuthAccessToken = async (
  raw: string | undefined | null,
  origin: string,
  now = new Date()
): Promise<McpCaller | null> => {
  if (!looksLikeOAuthSecret("access", raw)) return null;
  const row = await prisma.mcpOAuthToken.findUnique({
    where: { tokenHash: hashOAuthSecret(raw) },
    select: {
      kind: true,
      expiresAt: true,
      revokedAt: true,
      grant: {
        select: {
          id: true,
          name: true,
          scopes: true,
          expiresAt: true,
          revokedAt: true,
          lastUsedAt: true,
          resource: true,
          staffUser: { select: { id: true, displayName: true, role: true, isActive: true } },
        },
      },
    },
  });
  if (!row || row.kind !== "access" || row.revokedAt || row.expiresAt.getTime() <= now.getTime()) return null;
  const grant = row.grant;
  if (grant.revokedAt || (grant.expiresAt && grant.expiresAt.getTime() <= now.getTime())) return null;
  if (!grant.staffUser.isActive) return null;
  if (grant.resource && !resourceMatches(grant.resource, origin)) return null;
  const scopes = effectiveScopes(grant.scopes, grant.staffUser.role);
  if (scopes.length === 0) return null;

  if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS) {
    await prisma.mcpAccessToken
      .updateMany({
        where: {
          id: grant.id,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_THROTTLE_MS) } }],
        },
        data: { lastUsedAt: now },
      })
      .catch(() => undefined);
  }

  return {
    tokenId: grant.id,
    tokenName: grant.name,
    staffId: grant.staffUser.id,
    staffName: grant.staffUser.displayName,
    role: grant.staffUser.role,
    scopes,
    expiresAt: row.expiresAt,
    via: "oauth",
  };
};
