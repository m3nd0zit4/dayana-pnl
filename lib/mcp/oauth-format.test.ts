import { describe, expect, test } from "bun:test";
import {
  authorizationServerMetadata,
  describeRedirect,
  generateClientId,
  generateOAuthSecret,
  isAllowedRedirectUri,
  isClientMetadataUrl,
  looksLikeOAuthSecret,
  mcpResourceUrl,
  parseClientMetadataDocument,
  parseRegistrationRequest,
  parseScopeParam,
  pkceChallengeFor,
  protectedResourceMetadata,
  redirectUriMatches,
  redirectWith,
  resourceMatches,
  verifyPkce,
} from "./oauth-format";

describe("tokens OAuth", () => {
  test("cada tipo tiene su prefijo y no se confunden", () => {
    const access = generateOAuthSecret("access");
    expect(access).toMatch(/^dpat_[A-Za-z0-9_-]{43}$/);
    expect(looksLikeOAuthSecret("access", access)).toBe(true);
    expect(looksLikeOAuthSecret("refresh", access)).toBe(false);
    expect(looksLikeOAuthSecret("access", `dpnl_${access.slice(5)}`)).toBe(false);
    expect(looksLikeOAuthSecret("code", generateOAuthSecret("code"))).toBe(true);
    expect(looksLikeOAuthSecret("access", "dpat_corto")).toBe(false);
    expect(looksLikeOAuthSecret("access", undefined)).toBe(false);
    expect(generateClientId()).toMatch(/^dpcl_[A-Za-z0-9_-]{22}$/);
  });
});

describe("PKCE S256", () => {
  // Ejemplo del apéndice B de RFC 7636.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  test("el verificador correcto pasa", () => {
    expect(pkceChallengeFor(verifier)).toBe(challenge);
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  test("otro verificador, uno corto o ninguno, no", () => {
    expect(verifyPkce(`${verifier}x`, challenge)).toBe(false);
    expect(verifyPkce("corto", challenge)).toBe(false);
    expect(verifyPkce(null, challenge)).toBe(false);
  });
});

describe("redirect_uri", () => {
  test("https, loopback http y esquemas de aplicación", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:33418/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:5000/cb")).toBe(true);
    expect(isAllowedRedirectUri("cursor://anysphere.cursor-retrieval/oauth/callback")).toBe(true);
  });

  test("nunca http público, fragmentos, credenciales ni esquemas peligrosos", () => {
    expect(isAllowedRedirectUri("http://evil.example/cb")).toBe(false);
    expect(isAllowedRedirectUri("https://claude.ai/cb#x")).toBe(false);
    expect(isAllowedRedirectUri("https://user:pw@claude.ai/cb")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("data:text/html,hola")).toBe(false);
    expect(isAllowedRedirectUri("file:///etc/passwd")).toBe(false);
    expect(isAllowedRedirectUri("no es una url")).toBe(false);
  });

  test("coincidencia exacta, salvo el puerto de loopback", () => {
    const registered = ["https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:1234/callback"];
    expect(redirectUriMatches("https://claude.ai/api/mcp/auth_callback", registered)).toBe(true);
    expect(redirectUriMatches("https://claude.ai/api/mcp/auth_callback/", registered)).toBe(false);
    expect(redirectUriMatches("https://claude.ai/api/mcp/auth_callback?x=1", registered)).toBe(false);
    expect(redirectUriMatches("http://127.0.0.1:9999/callback", registered)).toBe(true);
    expect(redirectUriMatches("http://127.0.0.1:9999/otra", registered)).toBe(false);
    expect(redirectUriMatches("http://localhost:1234/callback", registered)).toBe(false);
  });

  test("lo que ve la persona", () => {
    expect(describeRedirect("https://claude.ai/api/mcp/auth_callback")).toEqual({ label: "claude.ai", known: "Claude", local: false });
    expect(describeRedirect("https://evil.example/cb").known).toBeNull();
    expect(describeRedirect("http://localhost:4000/cb").local).toBe(true);
  });

  test("el código vuelve con state e iss", () => {
    const url = new URL(redirectWith("https://claude.ai/cb?a=1", { code: "dpac_x", state: "s t", iss: "https://www.x.com", error: undefined }));
    expect(url.searchParams.get("a")).toBe("1");
    expect(url.searchParams.get("code")).toBe("dpac_x");
    expect(url.searchParams.get("state")).toBe("s t");
    expect(url.searchParams.get("iss")).toBe("https://www.x.com");
    expect(url.searchParams.has("error")).toBe(false);
  });
});

describe("scopes y recurso", () => {
  test("se ignora lo desconocido; sin nada válido, null", () => {
    expect(parseScopeParam("read edit execute")).toEqual(["read", "edit", "execute"]);
    expect(parseScopeParam("execute openid read")).toEqual(["read", "execute"]);
    expect(parseScopeParam("openid offline_access")).toBeNull();
    expect(parseScopeParam("")).toBeNull();
    expect(parseScopeParam(null)).toBeNull();
  });

  test("resource = este /api/mcp (con o sin barra, o el origen)", () => {
    const origin = "https://www.dayanabeltran.com";
    expect(mcpResourceUrl(origin)).toBe("https://www.dayanabeltran.com/api/mcp");
    expect(resourceMatches("https://www.dayanabeltran.com/api/mcp", origin)).toBe(true);
    expect(resourceMatches("https://www.dayanabeltran.com/api/mcp/", origin)).toBe(true);
    expect(resourceMatches("https://www.dayanabeltran.com", origin)).toBe(true);
    expect(resourceMatches("https://dayanabeltran.com/api/mcp", origin)).toBe(false);
    expect(resourceMatches("https://otro.com/api/mcp", origin)).toBe(false);
  });

  test("metadatos publicados", () => {
    const as = authorizationServerMetadata("https://www.x.com");
    expect(as.issuer).toBe("https://www.x.com");
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.response_types_supported).toEqual(["code"]);
    expect(as.registration_endpoint).toBe("https://www.x.com/api/mcp/oauth/register");
    expect(as.authorization_endpoint).toBe("https://www.x.com/admin/autorizar-mcp");
    const pr = protectedResourceMetadata("https://www.x.com");
    expect(pr.resource).toBe("https://www.x.com/api/mcp");
    expect(pr.authorization_servers).toEqual(["https://www.x.com"]);
  });
});

describe("registro dinámico (RFC 7591)", () => {
  test("el registro típico de claude.ai", () => {
    const parsed = parseRegistrationRequest({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope: "read edit execute",
    });
    expect(parsed).toEqual({
      ok: true,
      client: {
        name: "Claude",
        redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
        tokenEndpointAuthMethod: "client_secret_post",
        clientUri: null,
        logoUri: null,
      },
    });
  });

  test("por defecto client_secret_basic; nombre por defecto y limpio", () => {
    const parsed = parseRegistrationRequest({ redirect_uris: ["http://localhost:3000/cb"], client_name: "  Mi\u0007 app " });
    expect(parsed.ok && parsed.client.tokenEndpointAuthMethod).toBe("client_secret_basic");
    expect(parsed.ok && parsed.client.name).toBe("Mi app");
    const unnamed = parseRegistrationRequest({ redirect_uris: ["http://localhost:3000/cb"] });
    expect(unnamed.ok && unnamed.client.name).toBe("Cliente MCP");
  });

  test("rechaza lo que no sabemos hacer", () => {
    expect(parseRegistrationRequest({}).ok).toBe(false);
    expect(parseRegistrationRequest({ redirect_uris: [] }).ok).toBe(false);
    expect(parseRegistrationRequest({ redirect_uris: ["http://evil.example/cb"] })).toMatchObject({ error: "invalid_redirect_uri" });
    expect(parseRegistrationRequest({ redirect_uris: ["https://a.com/cb"], grant_types: ["client_credentials"] }).ok).toBe(false);
    expect(parseRegistrationRequest({ redirect_uris: ["https://a.com/cb"], response_types: ["token"] }).ok).toBe(false);
    expect(parseRegistrationRequest({ redirect_uris: ["https://a.com/cb"], token_endpoint_auth_method: "private_key_jwt" }).ok).toBe(false);
    expect(parseRegistrationRequest([1]).ok).toBe(false);
  });
});

describe("Client ID Metadata Documents", () => {
  const url = "https://claude.ai/oauth/mcp-client-metadata.json";

  test("solo URLs https públicas con ruta", () => {
    expect(isClientMetadataUrl(url)).toBe(true);
    expect(isClientMetadataUrl("https://claude.ai/")).toBe(false);
    expect(isClientMetadataUrl("http://claude.ai/meta.json")).toBe(false);
    expect(isClientMetadataUrl("https://127.0.0.1/meta.json")).toBe(false);
    expect(isClientMetadataUrl("https://[::1]/meta.json")).toBe(false);
    expect(isClientMetadataUrl("https://localhost/meta.json")).toBe(false);
    expect(isClientMetadataUrl("https://db.internal/meta.json")).toBe(false);
    expect(isClientMetadataUrl("https://claude.ai:8443/meta.json")).toBe(false);
    expect(isClientMetadataUrl("dpcl_abc")).toBe(false);
  });

  test("el client_id del documento tiene que ser su URL y el cliente, público", () => {
    const doc = { client_id: url, client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] };
    expect(parseClientMetadataDocument(url, doc)).toMatchObject({ ok: true, client: { name: "Claude", tokenEndpointAuthMethod: "none" } });
    expect(parseClientMetadataDocument(url, { ...doc, client_id: "https://otro.com/meta.json" }).ok).toBe(false);
    expect(parseClientMetadataDocument(url, { ...doc, token_endpoint_auth_method: "private_key_jwt" }).ok).toBe(false);
    expect(parseClientMetadataDocument(url, { ...doc, redirect_uris: ["http://evil.example/cb"] }).ok).toBe(false);
  });
});
