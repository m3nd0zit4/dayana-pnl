/**
 * OAuth del servidor MCP de punta a punta, como lo hace claude.ai «Add custom
 * connector», contra la base de DESARROLLO.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/mcp/mcp-oauth-e2e.ts
 *   bun --env-file=../dayana-pnl/.env scripts/mcp/mcp-oauth-e2e.ts --base=http://localhost:3100
 *
 * Sin `--base` llama a los handlers dentro del proceso y el consentimiento se
 * da con `approveAuthorization` (la pantalla necesita Next). Con `--base` va por
 * HTTP contra un `next dev` local: abre la pantalla de consentimiento con una
 * sesión real del OWNER de dev (como `scripts/dev/staff-session-cookie.ts`) y
 * pulsa «Permitir» con el formulario.
 *
 * Recorre: 401 con `resource_metadata` → metadatos del recurso y del servidor
 * → registro dinámico (como claude.ai, `client_secret_post`) → autorización
 * con PKCE S256, `state` y `resource` → canje → `initialize` + `tools/list` con
 * los scopes elegidos → una edición deja `MCP_TOOL_CALL` con `via: oauth` →
 * refresh rotativo → repetir un refresh viejo revoca la conexión → reautorizar
 * reemplaza la anterior → revocar desde Ajustes da 401 → PKCE malo, código
 * repetido, `redirect_uri` ajena, `resource` ajeno y registro con http público
 * fallan → un READONLY solo obtiene `read`. Borra lo que crea al terminar.
 *
 * NUNCA llama herramientas de envío.
 */
import crypto from "node:crypto";

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname;
  } catch {
    return "";
  }
})();
if (dbName !== "/neondb_dev") {
  console.error("Solo contra neondb_dev. DATABASE_URL apunta a otra base: no hago nada.");
  process.exit(1);
}
const baseArg = process.argv.find((a) => a.startsWith("--base="))?.slice(7);
if (baseArg && !["localhost", "127.0.0.1"].includes(new URL(baseArg).hostname)) {
  console.error("--base solo para un servidor local.");
  process.exit(1);
}
const BASE = baseArg ?? "http://localhost:3000";
const HTTP = Boolean(baseArg);

const { prisma } = await import("@/lib/db");
const oauth = await import("@/lib/mcp/oauth");
const { revokeMcpToken } = await import("@/lib/mcp/tokens");
const { visibleTools } = await import("@/lib/mcp/scopes");

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const PROTOCOL = "2025-06-18";

// ── transporte: HTTP real o los handlers dentro del proceso ─────────────────

type Handler = (req: Request) => Response | Promise<Response>;
const routes: Record<string, Record<string, unknown>> = HTTP
  ? {}
  : {
      "/api/mcp": await import("@/app/api/mcp/route"),
      "/.well-known/oauth-protected-resource/api/mcp": await import("@/app/.well-known/oauth-protected-resource/api/mcp/route"),
      "/.well-known/oauth-protected-resource": await import("@/app/.well-known/oauth-protected-resource/route"),
      "/.well-known/oauth-authorization-server": await import("@/app/.well-known/oauth-authorization-server/route"),
      "/api/mcp/oauth/register": await import("@/app/api/mcp/oauth/register/route"),
      "/api/mcp/oauth/token": await import("@/app/api/mcp/oauth/token/route"),
      "/api/mcp/oauth/revoke": await import("@/app/api/mcp/oauth/revoke/route"),
    };

const send = async (url: string, init: RequestInit = {}): Promise<Response> => {
  if (HTTP) return fetch(url, { ...init, redirect: "manual" });
  const req = new Request(url, init);
  const route = routes[new URL(url).pathname];
  const method = (init.method ?? "GET").toUpperCase();
  const handler = route?.[method] as Handler | undefined;
  if (typeof handler !== "function") return new Response("not found", { status: 404 });
  return handler(req);
};

let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const form = (data: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(data).toString(),
});

let rpcId = 0;
const rpc = async (token: string | null, method: string, params: Record<string, unknown> = {}) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await send(`${BASE}/api/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  let body: { result?: Record<string, unknown>; error?: { message: string } } | null = null;
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    body =
      text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => JSON.parse(l.slice(5).trim()))
        .find((m) => m.id === rpcId) ?? null;
  } else if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: res.status, headers: res.headers, body };
};

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString("base64url");
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
};

type Client = { client_id: string; client_secret?: string };
const createdClients: string[] = [];
let staffSessionId: string | null = null;

const register = async (body: Record<string, unknown>) => {
  const res = await send(`${BASE}/api/mcp/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Client & { error?: string };
  if (json.client_id) createdClients.push(json.client_id);
  return { status: res.status, json };
};

const tokenRequest = async (client: Client, data: Record<string, string>) => {
  const res = await send(`${BASE}/api/mcp/oauth/token`, form({ client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}), ...data }));
  return { status: res.status, json: (await res.json()) as Record<string, string> };
};

const authorizeUrl = (meta: { authorization_endpoint: string }, client: Client, challenge: string, resource: string, extra: Record<string, string> = {}) => {
  const url = new URL(meta.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "read edit execute",
    state: `st-${crypto.randomUUID()}`,
    resource,
    ...extra,
  }).toString();
  return url;
};

/** «Permitir» en la pantalla, con estos permisos marcados. Devuelve a dónde manda el navegador. */
const consent = async (
  url: URL,
  staff: { id: string; role: import("@prisma/client").StaffRole },
  chosen: string[]
): Promise<URL> => {
  if (!HTTP) {
    const checked = await oauth.checkAuthorizationRequest(url.searchParams, BASE);
    if (checked.kind !== "ok") throw new Error(`consentimiento: ${checked.kind}`);
    return new URL(await oauth.approveAuthorization({ staff, client: checked.client, request: checked.request, chosen, origin: BASE }));
  }
  const cookie = await staffCookie(staff.id);
  const page = await fetch(url, { headers: { cookie }, redirect: "manual" });
  const html = await page.text();
  check("pantalla de consentimiento 200 con la app y los permisos", page.status === 200 && html.includes("Conectar con el CRM") && html.includes("grant_scope"), `HTTP ${page.status}`);
  const body = new URLSearchParams(url.searchParams);
  for (const s of chosen) body.append("grant_scope", s);
  body.set("decision", "approve");
  const res = await fetch(`${BASE}/api/admin/mcp-oauth/authorize`, {
    method: "POST",
    headers: { cookie, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });
  if (res.status !== 303) throw new Error(`Permitir respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return new URL(res.headers.get("location") ?? "");
};

const staffCookie = async (staffId: string) => {
  const { encode } = await import("next-auth/jwt");
  const { createStaffSession } = await import("@/lib/auth/staff-sessions");
  const staff = await prisma.staffUser.findUniqueOrThrow({ where: { id: staffId } });
  if (!staffSessionId) staffSessionId = (await createStaffSession({ staffUserId: staff.id })).id;
  const name = "authjs.session-token";
  const value = await encode({
    secret: process.env.AUTH_SECRET!,
    salt: name,
    token: { kind: "staff", staffId: staff.id, role: staff.role, sessionId: staffSessionId, email: staff.email, name: staff.displayName, sub: staff.id },
  });
  return `${name}=${value}`;
};

try {
  const owner = await prisma.staffUser.findFirst({
    where: { role: "OWNER", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, displayName: true },
  });
  if (!owner) throw new Error("No hay OWNER activo en dev.");
  const since = new Date();

  // ── descubrimiento ─────────────────────────────────────────────────────────
  const unauth = await rpc(null, "initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  const challenge = unauth.headers.get("www-authenticate") ?? "";
  const prmUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  check("401 sin token con resource_metadata", unauth.status === 401 && Boolean(prmUrl), challenge.slice(0, 160));

  const prm = (await (await send(prmUrl ?? `${BASE}/.well-known/oauth-protected-resource/api/mcp`)).json()) as {
    resource: string;
    authorization_servers: string[];
    scopes_supported: string[];
  };
  check("metadatos del recurso (RFC 9728)", prm.resource === `${BASE}/api/mcp` && prm.authorization_servers[0] === BASE, JSON.stringify(prm));
  const root = (await (await send(`${BASE}/.well-known/oauth-protected-resource`)).json()) as { resource: string };
  check("metadatos del recurso también en la raíz", root.resource === prm.resource);

  const meta = (await (await send(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json()) as {
    issuer: string;
    authorization_endpoint: string;
    registration_endpoint: string;
    token_endpoint: string;
    code_challenge_methods_supported: string[];
  };
  check(
    "metadatos del servidor (RFC 8414)",
    meta.issuer === BASE && meta.code_challenge_methods_supported.includes("S256") && Boolean(meta.registration_endpoint),
    meta.authorization_endpoint
  );

  // ── registro dinámico como claude.ai ───────────────────────────────────────
  const reg = await register({
    client_name: "Claude (e2e)",
    redirect_uris: [REDIRECT],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
    scope: prm.scopes_supported.join(" "),
  });
  const client = reg.json;
  check("registro dinámico 201 con secreto", reg.status === 201 && client.client_id.startsWith("dpcl_") && Boolean(client.client_secret));
  const evil = await register({ client_name: "x", redirect_uris: ["http://evil.example/cb"] });
  check("registro con http público rechazado", evil.status === 400 && evil.json.error === "invalid_redirect_uri");

  // ── autorización + canje ───────────────────────────────────────────────────
  const p1 = pkce();
  const authUrl = authorizeUrl(meta, client, p1.challenge, prm.resource);
  const back = await consent(authUrl, owner, ["read", "edit"]);
  check(
    "vuelve a claude.ai con code, state e iss",
    back.origin + back.pathname === REDIRECT &&
      back.searchParams.get("state") === authUrl.searchParams.get("state") &&
      back.searchParams.get("iss") === BASE &&
      (back.searchParams.get("code") ?? "").startsWith("dpac_")
  );
  const code = back.searchParams.get("code") ?? "";

  const wrongPkce = await tokenRequest(client, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: pkce().verifier, resource: prm.resource });
  check("PKCE incorrecto → invalid_grant", wrongPkce.status === 400 && wrongPkce.json.error === "invalid_grant");
  const noSecret = await tokenRequest({ client_id: client.client_id }, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: p1.verifier });
  check("sin secreto del cliente → invalid_client 401", noSecret.status === 401 && noSecret.json.error === "invalid_client");

  const exchanged = await tokenRequest(client, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: p1.verifier, resource: prm.resource });
  const tokens = exchanged.json;
  check(
    "canje: access + refresh, scope read edit",
    exchanged.status === 200 && tokens.access_token?.startsWith("dpat_") && tokens.refresh_token?.startsWith("dprt_") && tokens.scope === "read edit" && tokens.token_type === "Bearer",
    JSON.stringify({ status: exchanged.status, scope: tokens.scope, expires_in: tokens.expires_in, error: tokens.error })
  );

  const grant = await prisma.mcpAccessToken.findFirst({ where: { oauthClientId: client.client_id, revokedAt: null } });
  check("la conexión es una fila de Conexiones MCP", Boolean(grant) && grant?.prefix === "oauth" && grant?.tokenHash === null && grant.name === "Claude (e2e)");
  const createdAudit = await prisma.auditLog.findFirst({ where: { action: "MCP_TOKEN_CREATED", entityId: grant?.id ?? "-" } });
  check("auditada como MCP_TOKEN_CREATED via oauth", (createdAudit?.changes as Record<string, unknown> | null)?.via === "oauth");

  // ── usar el MCP ────────────────────────────────────────────────────────────
  const init = await rpc(tokens.access_token, "initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  check("initialize con el access token", init.status === 200 && Boolean(init.body?.result), `HTTP ${init.status}`);
  const list = await rpc(tokens.access_token, "tools/list");
  const names = ((list.body?.result?.tools ?? []) as { name: string }[]).map((t) => t.name);
  check("tools/list = read+edit", names.length === visibleTools(["read", "edit"]).length && !names.includes("record_manual_payment"), `${names.length}`);
  const mem = await rpc(tokens.access_token, "tools/call", { name: "memory", arguments: { action: "list" } });
  check("llamada de edición (memory list)", mem.status === 200 && !(mem.body?.result as { isError?: boolean } | undefined)?.isError);
  const toolAudit = await prisma.auditLog.findFirst({
    where: { action: "MCP_TOOL_CALL", entityId: "memory", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
  });
  const toolChanges = (toolAudit?.changes ?? {}) as Record<string, unknown>;
  check("MCP_TOOL_CALL con la conexión OAuth", toolChanges.tokenId === grant?.id && toolChanges.via === "oauth");
  const pay = await rpc(tokens.access_token, "tools/call", { name: "record_manual_payment", arguments: {} });
  check("execute no permitido con read+edit", Boolean(pay.body?.error) || Boolean((pay.body?.result as { isError?: boolean } | undefined)?.isError));

  // ── refresh rotativo ───────────────────────────────────────────────────────
  const refreshed = await tokenRequest(client, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, resource: prm.resource });
  check("refresh: tokens nuevos", refreshed.status === 200 && refreshed.json.refresh_token !== tokens.refresh_token && refreshed.json.access_token !== tokens.access_token);
  const again = await tokenRequest(client, { grant_type: "refresh_token", refresh_token: tokens.refresh_token });
  check("refresh viejo enseguida → invalid_grant sin revocar", again.status === 400 && again.json.error === "invalid_grant");
  const stillOk = await rpc(refreshed.json.access_token, "tools/list");
  check("la conexión sigue viva tras el roce", stillOk.status === 200);

  // ── reautorizar el mismo cliente reemplaza la conexión ─────────────────────
  const p2 = pkce();
  const back2 = await consent(authorizeUrl(meta, client, p2.challenge, prm.resource), owner, ["read", "edit", "execute"]);
  const code2 = back2.searchParams.get("code") ?? "";
  const ex2 = await tokenRequest(client, { grant_type: "authorization_code", code: code2, redirect_uri: REDIRECT, code_verifier: p2.verifier });
  check("segunda autorización con execute", ex2.status === 200 && ex2.json.scope === "read edit execute");
  const old = await rpc(refreshed.json.access_token, "tools/list");
  check("la conexión anterior quedó reemplazada (401)", old.status === 401);
  const grant2 = await prisma.mcpAccessToken.findFirst({ where: { oauthClientId: client.client_id, revokedAt: null } });

  const reuse = await tokenRequest(client, { grant_type: "authorization_code", code: code2, redirect_uri: REDIRECT, code_verifier: p2.verifier });
  const afterReuse = await rpc(ex2.json.access_token, "tools/list");
  check("código repetido → invalid_grant y la conexión se revoca", reuse.json.error === "invalid_grant" && afterReuse.status === 401);

  // ── refresh viejo pasado el margen → revoca ────────────────────────────────
  const p3 = pkce();
  const back3 = await consent(authorizeUrl(meta, client, p3.challenge, prm.resource), owner, ["read"]);
  const ex3 = await tokenRequest(client, { grant_type: "authorization_code", code: back3.searchParams.get("code") ?? "", redirect_uri: REDIRECT, code_verifier: p3.verifier });
  const r3 = await tokenRequest(client, { grant_type: "refresh_token", refresh_token: ex3.json.refresh_token });
  const clientRow = await oauth.resolveOAuthClient(client.client_id);
  const replay = await oauth
    .refreshAccessToken({ client: clientRow!, refreshToken: ex3.json.refresh_token, scope: null, resource: null, origin: BASE, now: new Date(Date.now() + 120_000) })
    .then(() => "ok")
    .catch((e: { error?: string }) => e.error ?? "x");
  const afterReplay = await rpc(r3.json.access_token, "tools/list");
  check("refresh repetido después de 30 s revoca la conexión", replay === "invalid_grant" && afterReplay.status === 401);

  // ── revocar desde Ajustes ──────────────────────────────────────────────────
  const p4 = pkce();
  const back4 = await consent(authorizeUrl(meta, client, p4.challenge, prm.resource), owner, ["read"]);
  const ex4 = await tokenRequest(client, { grant_type: "authorization_code", code: back4.searchParams.get("code") ?? "", redirect_uri: REDIRECT, code_verifier: p4.verifier });
  const grant4 = await prisma.mcpAccessToken.findFirst({ where: { oauthClientId: client.client_id, revokedAt: null } });
  const before = await rpc(ex4.json.access_token, "tools/list");
  await revokeMcpToken({ id: owner.id, role: owner.role }, grant4!.id);
  const after = await rpc(ex4.json.access_token, "tools/list");
  const refreshAfter = await tokenRequest(client, { grant_type: "refresh_token", refresh_token: ex4.json.refresh_token });
  check("revocar en Ajustes → 401 y el refresh tampoco sirve", before.status === 200 && after.status === 401 && refreshAfter.json.error === "invalid_grant");

  // ── peticiones malas en la autorización ────────────────────────────────────
  const foreign = await oauth.checkAuthorizationRequest(
    authorizeUrl(meta, client, pkce().challenge, prm.resource, { redirect_uri: "https://evil.example/cb" }).searchParams,
    BASE
  );
  check("redirect_uri ajena → error en pantalla, sin redirigir", foreign.kind === "fatal");
  const noPkce = authorizeUrl(meta, client, "x", prm.resource);
  noPkce.searchParams.delete("code_challenge");
  const noPkceCheck = await oauth.checkAuthorizationRequest(noPkce.searchParams, BASE);
  check("sin PKCE → vuelve con invalid_request", noPkceCheck.kind === "redirect" && noPkceCheck.url.includes("error=invalid_request"));
  const otherResource = await oauth.checkAuthorizationRequest(authorizeUrl(meta, client, pkce().challenge, "https://otro.example/api/mcp").searchParams, BASE);
  check("resource ajeno → invalid_target", otherResource.kind === "redirect" && otherResource.url.includes("error=invalid_target"));

  // ── el rol manda: un READONLY solo obtiene read ────────────────────────────
  const p5 = pkce();
  const back5 = await (async () => {
    const checked = await oauth.checkAuthorizationRequest(authorizeUrl(meta, client, p5.challenge, prm.resource).searchParams, BASE);
    if (checked.kind !== "ok") throw new Error("readonly");
    return new URL(
      await oauth.approveAuthorization({ staff: { id: owner.id, role: "READONLY" }, client: checked.client, request: checked.request, chosen: ["read", "edit", "execute"], origin: BASE })
    );
  })();
  const ex5 = await tokenRequest(client, { grant_type: "authorization_code", code: back5.searchParams.get("code") ?? "", redirect_uri: REDIRECT, code_verifier: p5.verifier });
  check("READONLY: el código solo lleva read aunque marque todo", ex5.json.scope === "read");

  // ── cliente público (Claude Code / CIMD usan `none`) ───────────────────────
  const pub = await register({ client_name: "Cliente local (e2e)", redirect_uris: ["http://127.0.0.1:43123/callback"], token_endpoint_auth_method: "none" });
  const p6 = pkce();
  const pubUrl = authorizeUrl(meta, pub.json, p6.challenge, prm.resource, { redirect_uri: "http://127.0.0.1:50000/callback" });
  const back6 = new URL(
    await (async () => {
      const checked = await oauth.checkAuthorizationRequest(pubUrl.searchParams, BASE);
      if (checked.kind !== "ok") throw new Error(`público: ${checked.kind}`);
      return oauth.approveAuthorization({ staff: owner, client: checked.client, request: checked.request, chosen: ["read"], origin: BASE });
    })()
  );
  const ex6 = await tokenRequest({ client_id: pub.json.client_id }, { grant_type: "authorization_code", code: back6.searchParams.get("code") ?? "", redirect_uri: "http://127.0.0.1:50000/callback", code_verifier: p6.verifier });
  check("cliente público con otro puerto de loopback", pub.status === 201 && !pub.json.client_secret && ex6.status === 200, ex6.json.error ?? "");

  results.push(`conexiones de la prueba: ${[grant?.id, grant2?.id, grant4?.id].filter(Boolean).length} + otras`);
} catch (error) {
  failures++;
  results.push(`FAIL  excepción: ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  if (createdClients.length) {
    await prisma.mcpAccessToken.deleteMany({ where: { oauthClientId: { in: createdClients } } });
    await prisma.mcpOAuthClient.deleteMany({ where: { id: { in: createdClients } } });
  }
  if (staffSessionId) await prisma.staffSession.delete({ where: { id: staffSessionId } }).catch(() => undefined);
}

console.log(results.join("\n"));
console.log(failures ? `\n${failures} fallo(s).` : "\nTodo bien.");
await prisma.$disconnect();
process.exit(failures ? 1 : 0);
