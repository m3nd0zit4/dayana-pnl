import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { GoogleService } from "@prisma/client";
import {
  buildAuthorizationUrl,
  createGoogleTokenProvider,
  GOOGLE_TOKEN_URL,
  googleOAuthClient,
  googleRedirectUri,
  GoogleReauthorizationRequiredError,
  GoogleTokenError,
  parseGrantedScopes,
  RECONNECT_ONCE_MESSAGE,
  type StoredGoogleAccount,
} from "./oauth";
import { SERVICE_SCOPES, missingServiceScopes, servicesMissingScopes } from "./scopes";

/**
 * Sin red ni base: `fetch` simulado y un almacén en memoria. Lo que se prueba
 * es la caché, el reparto de errores (invalid_grant apaga, lo demás no) y la
 * comprobación de scopes.
 */

const CALENDAR = SERVICE_SCOPES.CALENDAR[0];
const MEET = SERVICE_SCOPES.MEET[0];
const CLIENT = { clientId: "client-id", clientSecret: "client-secret" };

type Call = { url: string; body: URLSearchParams };

const makeHarness = (account: Partial<StoredGoogleAccount> = {}) => {
  let clock = 1_000_000;
  const calls: Call[] = [];
  const marked: { accountId: string; reason: string }[] = [];
  const rotated: string[] = [];
  let reply: () => Response = () =>
    Response.json({ access_token: `at-${calls.length}`, expires_in: 3600 });

  const row: StoredGoogleAccount = {
    id: "acc_1",
    isActive: true,
    services: ["CALENDAR"],
    refreshTokenEnc: "sealed:rt-1",
    grantedScopes: ["openid", CALENDAR],
    ...account,
  };

  const provider = createGoogleTokenProvider({
    client: () => CLIENT,
    now: () => clock,
    fetchImpl: async (url, init) => {
      calls.push({ url, body: new URLSearchParams(String(init?.body ?? "")) });
      return reply();
    },
    store: {
      load: async (id) => (id === row.id ? { ...row } : null),
      markNeedsReauthorization: async (accountId, reason) => {
        marked.push({ accountId, reason });
        row.isActive = false;
      },
      saveRotatedRefreshToken: async (_id, token) => {
        rotated.push(token);
      },
      open: (sealed) => sealed.replace(/^sealed:/, ""),
    },
  });

  return {
    provider,
    row,
    calls,
    marked,
    rotated,
    advance: (ms: number) => {
      clock += ms;
    },
    setReply: (fn: () => Response) => {
      reply = fn;
    },
  };
};

describe("getAccountToken", () => {
  test("cambia el refresh token por un access token con grant_type=refresh_token", async () => {
    const h = makeHarness();
    expect(await h.provider.getAccountToken("acc_1")).toBe("at-1");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe(GOOGLE_TOKEN_URL);
    expect(h.calls[0].body.get("grant_type")).toBe("refresh_token");
    expect(h.calls[0].body.get("refresh_token")).toBe("rt-1");
    expect(h.calls[0].body.get("client_id")).toBe("client-id");
    expect(h.calls[0].body.get("client_secret")).toBe("client-secret");
  });

  test("cachea hasta ~60 s antes de caducar", async () => {
    const h = makeHarness();
    await h.provider.getAccountToken("acc_1");
    h.advance(3600_000 - 61_000);
    expect(await h.provider.getAccountToken("acc_1")).toBe("at-1");
    expect(h.calls).toHaveLength(1);
    h.advance(2_000);
    expect(await h.provider.getAccountToken("acc_1")).toBe("at-2");
    expect(h.calls).toHaveLength(2);
  });

  test("peticiones simultáneas comparten un solo refresco", async () => {
    const h = makeHarness();
    const tokens = await Promise.all([
      h.provider.getAccountToken("acc_1"),
      h.provider.getAccountToken("acc_1"),
      h.provider.getAccountToken("acc_1"),
    ]);
    expect(tokens).toEqual(["at-1", "at-1", "at-1"]);
    expect(h.calls).toHaveLength(1);
  });

  test("un refresh token nuevo (reconexión) invalida la caché", async () => {
    const h = makeHarness();
    await h.provider.getAccountToken("acc_1");
    h.row.refreshTokenEnc = "sealed:rt-2";
    expect(await h.provider.getAccountToken("acc_1")).toBe("at-2");
    expect(h.calls[1].body.get("refresh_token")).toBe("rt-2");
  });

  test("forget obliga a refrescar", async () => {
    const h = makeHarness();
    await h.provider.getAccountToken("acc_1");
    h.provider.forget("acc_1");
    await h.provider.getAccountToken("acc_1");
    expect(h.calls).toHaveLength(2);
  });

  test("guarda un refresh token rotado", async () => {
    const h = makeHarness();
    h.setReply(() =>
      Response.json({ access_token: "at-x", expires_in: 3600, refresh_token: "rt-nuevo" })
    );
    await h.provider.getAccountToken("acc_1");
    expect(h.rotated).toEqual(["rt-nuevo"]);
  });

  test("invalid_grant apaga la cuenta y pide reconectar", async () => {
    const h = makeHarness();
    h.setReply(() =>
      Response.json(
        { error: "invalid_grant", error_description: "Token has been expired or revoked." },
        { status: 400 }
      )
    );
    const error = await h.provider.getAccountToken("acc_1").catch((e) => e);
    expect(error).toBeInstanceOf(GoogleReauthorizationRequiredError);
    expect(h.marked).toHaveLength(1);
    expect(h.marked[0].accountId).toBe("acc_1");
    // Ya apagada: ni siquiera llama a Google.
    await expect(h.provider.getAccountToken("acc_1")).rejects.toBeInstanceOf(
      GoogleReauthorizationRequiredError
    );
    expect(h.calls).toHaveLength(1);
  });

  test("un 5xx o un error de red no apaga la cuenta", async () => {
    const h = makeHarness();
    h.setReply(() => Response.json({ error: "backend_error" }, { status: 503 }));
    const error = await h.provider.getAccountToken("acc_1").catch((e) => e);
    expect(error).toBeInstanceOf(GoogleTokenError);
    expect(error).not.toBeInstanceOf(GoogleReauthorizationRequiredError);
    expect(h.marked).toHaveLength(0);

    h.setReply(() => {
      throw new TypeError("fetch failed");
    });
    await expect(h.provider.getAccountToken("acc_1")).rejects.toBeInstanceOf(TypeError);
    expect(h.marked).toHaveLength(0);

    // Y en cuanto Google vuelve, funciona.
    h.setReply(() => Response.json({ access_token: "at-ok", expires_in: 3600 }));
    expect(await h.provider.getAccountToken("acc_1")).toBe("at-ok");
  });

  test("invalid_client (cliente mal configurado) no apaga la cuenta", async () => {
    const h = makeHarness();
    h.setReply(() => Response.json({ error: "invalid_client" }, { status: 401 }));
    await expect(h.provider.getAccountToken("acc_1")).rejects.toBeInstanceOf(GoogleTokenError);
    expect(h.marked).toHaveLength(0);
  });

  test("cuenta conectada por Vercel Connect (sin refresh token): reconectar una vez", async () => {
    const h = makeHarness({ refreshTokenEnc: null });
    const error = await h.provider.getAccountToken("acc_1").catch((e) => e);
    expect(error).toBeInstanceOf(GoogleReauthorizationRequiredError);
    expect(error.message).toBe(RECONNECT_ONCE_MESSAGE);
    expect(h.marked).toEqual([{ accountId: "acc_1", reason: RECONNECT_ONCE_MESSAGE }]);
    expect(h.calls).toHaveLength(0);
  });

  test("cuenta inactiva o inexistente", async () => {
    const h = makeHarness({ isActive: false });
    await expect(h.provider.getAccountToken("acc_1")).rejects.toBeInstanceOf(
      GoogleReauthorizationRequiredError
    );
    await expect(h.provider.getAccountToken("otra")).rejects.toThrow("no existe");
    expect(h.calls).toHaveLength(0);
  });

  test("falta el scope de un servicio de la cuenta: apaga y pide reconectar", async () => {
    const h = makeHarness({ services: ["CALENDAR", "DRIVE"] });
    await expect(h.provider.getAccountToken("acc_1")).rejects.toBeInstanceOf(
      GoogleReauthorizationRequiredError
    );
    expect(h.marked).toHaveLength(1);
    expect(h.calls).toHaveLength(0);
  });

  test("Meet sin permiso: falla solo la llamada de Meet, la cuenta sigue viva", async () => {
    const h = makeHarness({ services: ["CALENDAR", "MEET"] });
    // Por defecto Meet no se exige: el calendario funciona.
    expect(await h.provider.getAccountToken("acc_1")).toBe("at-1");
    await expect(h.provider.getAccountToken("acc_1", ["MEET"])).rejects.toBeInstanceOf(
      GoogleReauthorizationRequiredError
    );
    expect(h.marked).toHaveLength(0);
  });

  test("Meet concedido: el token sirve también para Meet", async () => {
    const h = makeHarness({
      services: ["CALENDAR", "MEET"],
      grantedScopes: ["openid", CALENDAR, MEET],
    });
    expect(await h.provider.getAccountToken("acc_1", ["MEET"])).toBe("at-1");
  });

  test("pedir un servicio que la cuenta no tiene no exige nada de más", async () => {
    const h = makeHarness();
    // `only` se filtra por los servicios de la cuenta, como antes.
    expect(await h.provider.getAccountToken("acc_1", ["DRIVE" as GoogleService])).toBe("at-1");
  });
});

describe("scopes", () => {
  test("missingServiceScopes / servicesMissingScopes", () => {
    expect(missingServiceScopes(["CALENDAR"], [CALENDAR])).toEqual([]);
    expect(missingServiceScopes(["CALENDAR", "MEET"], [CALENDAR])).toEqual([MEET]);
    expect(servicesMissingScopes(["CALENDAR", "DRIVE", "MEET"], [CALENDAR])).toEqual([
      "DRIVE",
      "MEET",
    ]);
  });

  test("parseGrantedScopes separa por espacios y quita duplicados", () => {
    expect(parseGrantedScopes(`openid  ${CALENDAR} ${CALENDAR}`)).toEqual(["openid", CALENDAR]);
    expect(parseGrantedScopes(undefined)).toEqual([]);
  });
});

describe("URL de autorización y configuración", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    for (const key of [
      "AUTH_GOOGLE_ID",
      "AUTH_GOOGLE_SECRET",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "GOOGLE_OAUTH_REDIRECT_URI",
      "NEXT_PUBLIC_SITE_URL",
    ]) {
      delete process.env[key];
    }
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  test("la URL pide offline + consent + scopes de los servicios", () => {
    const url = new URL(
      buildAuthorizationUrl({
        client: CLIENT,
        services: ["CALENDAR"],
        state: "st",
        redirectUri: "https://www.dayanabeltran.com/api/admin/google/callback",
      })
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("scope")?.split(" ")).toContain(CALENDAR);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://www.dayanabeltran.com/api/admin/google/callback"
    );
  });

  test("cliente: el del login por defecto; el propio solo si están los dos", () => {
    expect(googleOAuthClient()).toBeNull();
    process.env.AUTH_GOOGLE_ID = "login-id";
    process.env.AUTH_GOOGLE_SECRET = "login-secret";
    expect(googleOAuthClient()).toEqual({ clientId: "login-id", clientSecret: "login-secret" });
    process.env.GOOGLE_OAUTH_CLIENT_ID = "own-id";
    expect(googleOAuthClient()?.clientId).toBe("login-id");
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "own-secret";
    expect(googleOAuthClient()).toEqual({ clientId: "own-id", clientSecret: "own-secret" });
  });

  test("redirect_uri fija: del dominio del sitio, o la explícita", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.dayanabeltran.com/";
    expect(googleRedirectUri()).toBe("https://www.dayanabeltran.com/api/admin/google/callback");
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    expect(googleRedirectUri()).toBe("http://localhost:3000/api/admin/google/callback");
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://app.example.com/api/admin/google/callback";
    expect(googleRedirectUri()).toBe("https://app.example.com/api/admin/google/callback");
  });
});
