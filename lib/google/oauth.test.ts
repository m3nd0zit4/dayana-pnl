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
  UNREADABLE_TOKEN_MESSAGE,
  exchangeAuthorizationCode,
  type StoredGoogleAccount,
} from "./oauth";
import {
  SERVICE_SCOPES,
  missingServiceScopes,
  servicesMissingScopes,
  splitGrantedServices,
} from "./scopes";

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
    expect(await h.provider.getAccountToken("acc_1", ["CALENDAR"])).toBe("at-1");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe(GOOGLE_TOKEN_URL);
    expect(h.calls[0].body.get("grant_type")).toBe("refresh_token");
    expect(h.calls[0].body.get("refresh_token")).toBe("rt-1");
    expect(h.calls[0].body.get("client_id")).toBe("client-id");
    expect(h.calls[0].body.get("client_secret")).toBe("client-secret");
  });

  test("cachea hasta ~60 s antes de caducar", async () => {
    const h = makeHarness();
    await h.provider.getAccountToken("acc_1", ["CALENDAR"]);
    h.advance(3600_000 - 61_000);
    expect(await h.provider.getAccountToken("acc_1", ["CALENDAR"])).toBe("at-1");
    expect(h.calls).toHaveLength(1);
    h.advance(2_000);
    expect(await h.provider.getAccountToken("acc_1", ["CALENDAR"])).toBe("at-2");
    expect(h.calls).toHaveLength(2);
  });

  test("peticiones simultáneas comparten un solo refresco", async () => {
    const h = makeHarness();
    const tokens = await Promise.all([
      h.provider.getAccountToken("acc_1", ["CALENDAR"]),
      h.provider.getAccountToken("acc_1", ["CALENDAR"]),
      h.provider.getAccountToken("acc_1", ["CALENDAR"]),
    ]);
    expect(tokens).toEqual(["at-1", "at-1", "at-1"]);
    expect(h.calls).toHaveLength(1);
  });

  test("un refresh token nuevo (reconexión) invalida la caché", async () => {
    const h = makeHarness();
    await h.provider.getAccountToken("acc_1", ["CALENDAR"]);
    h.row.refreshTokenEnc = "sealed:rt-2";
    expect(await h.provider.getAccountToken("acc_1", ["CALENDAR"])).toBe("at-2");
    expect(h.calls[1].body.get("refresh_token")).toBe("rt-2");
  });

  test("forget obliga a refrescar", async () => {
    const h = makeHarness();
    await h.provider.getAccountToken("acc_1", ["CALENDAR"]);
    h.provider.forget("acc_1");
    await h.provider.getAccountToken("acc_1", ["CALENDAR"]);
    expect(h.calls).toHaveLength(2);
  });

  test("guarda un refresh token rotado", async () => {
    const h = makeHarness();
    h.setReply(() =>
      Response.json({ access_token: "at-x", expires_in: 3600, refresh_token: "rt-nuevo" })
    );
    await h.provider.getAccountToken("acc_1", ["CALENDAR"]);
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
    const error = await h.provider.getAccountToken("acc_1", ["CALENDAR"]).catch((e) => e);
    expect(error).toBeInstanceOf(GoogleReauthorizationRequiredError);
    expect(h.marked).toHaveLength(1);
    expect(h.marked[0].accountId).toBe("acc_1");
    // Ya apagada: ni siquiera llama a Google.
    await expect(h.provider.getAccountToken("acc_1", ["CALENDAR"])).rejects.toBeInstanceOf(
      GoogleReauthorizationRequiredError
    );
    expect(h.calls).toHaveLength(1);
  });

  test("un 5xx o un error de red no apaga la cuenta", async () => {
    const h = makeHarness();
    h.setReply(() => Response.json({ error: "backend_error" }, { status: 503 }));
    const error = await h.provider.getAccountToken("acc_1", ["CALENDAR"]).catch((e) => e);
    expect(error).toBeInstanceOf(GoogleTokenError);
    expect(error).not.toBeInstanceOf(GoogleReauthorizationRequiredError);
    expect(h.marked).toHaveLength(0);

    h.setReply(() => {
      throw new TypeError("fetch failed");
    });
    await expect(h.provider.getAccountToken("acc_1", ["CALENDAR"])).rejects.toBeInstanceOf(TypeError);
    expect(h.marked).toHaveLength(0);

    // Y en cuanto Google vuelve, funciona.
    h.setReply(() => Response.json({ access_token: "at-ok", expires_in: 3600 }));
    expect(await h.provider.getAccountToken("acc_1", ["CALENDAR"])).toBe("at-ok");
  });

  test("invalid_client (cliente mal configurado) no apaga la cuenta", async () => {
    const h = makeHarness();
    h.setReply(() => Response.json({ error: "invalid_client" }, { status: 401 }));
    await expect(h.provider.getAccountToken("acc_1", ["CALENDAR"])).rejects.toBeInstanceOf(GoogleTokenError);
    expect(h.marked).toHaveLength(0);
  });

  test("cuenta conectada por Vercel Connect (sin refresh token): reconectar una vez", async () => {
    const h = makeHarness({ refreshTokenEnc: null });
    const error = await h.provider.getAccountToken("acc_1", ["CALENDAR"]).catch((e) => e);
    expect(error).toBeInstanceOf(GoogleReauthorizationRequiredError);
    expect(error.message).toBe(RECONNECT_ONCE_MESSAGE);
    expect(h.marked).toEqual([{ accountId: "acc_1", reason: RECONNECT_ONCE_MESSAGE }]);
    expect(h.calls).toHaveLength(0);
  });

  test("cuenta inactiva o inexistente", async () => {
    const h = makeHarness({ isActive: false });
    await expect(h.provider.getAccountToken("acc_1", ["CALENDAR"])).rejects.toBeInstanceOf(
      GoogleReauthorizationRequiredError
    );
    await expect(h.provider.getAccountToken("otra", ["CALENDAR"])).rejects.toThrow("no existe");
    expect(h.calls).toHaveLength(0);
  });

  test("Drive sin permiso: falla solo Drive, el Calendario sigue agendando", async () => {
    // Caso real: se marcó Drive y la persona canceló o lo desmarcó en Google.
    const h = makeHarness({ services: ["CALENDAR", "DRIVE"] });
    const error = await h.provider.getAccountToken("acc_1", ["DRIVE"]).catch((e) => e);
    expect(error).toBeInstanceOf(GoogleReauthorizationRequiredError);
    expect(error.message).toContain("Drive");
    expect(h.marked).toHaveLength(0);
    expect(h.row.isActive).toBe(true);
    expect(await h.provider.getAccountToken("acc_1", ["CALENDAR"])).toBe("at-1");
  });

  test("Meet sin permiso: falla solo la llamada de Meet, la cuenta sigue viva", async () => {
    const h = makeHarness({ services: ["CALENDAR", "MEET"] });
    expect(await h.provider.getAccountToken("acc_1", ["CALENDAR"])).toBe("at-1");
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

  test("un servicio sin scope concedido nunca da token, aunque la cuenta no lo tenga marcado", async () => {
    const h = makeHarness();
    await expect(
      h.provider.getAccountToken("acc_1", ["DRIVE" as GoogleService])
    ).rejects.toBeInstanceOf(GoogleReauthorizationRequiredError);
    expect(h.marked).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  test("permiso guardado que no se puede descifrar: pide reconectar (no un error críptico)", async () => {
    const h = makeHarness();
    const provider = createGoogleTokenProvider({
      client: () => CLIENT,
      fetchImpl: async () => Response.json({ access_token: "nunca" }),
      store: {
        load: async () => ({ ...h.row }),
        markNeedsReauthorization: async (accountId, reason) => {
          h.marked.push({ accountId, reason });
        },
        saveRotatedRefreshToken: async () => undefined,
        open: () => {
          throw new Error("Unsupported state or unable to authenticate data");
        },
      },
    });
    const error = await provider.getAccountToken("acc_1", ["CALENDAR"]).catch((e) => e);
    expect(error).toBeInstanceOf(GoogleReauthorizationRequiredError);
    expect(error.message).toBe(UNREADABLE_TOKEN_MESSAGE);
    expect(h.marked).toEqual([{ accountId: "acc_1", reason: UNREADABLE_TOKEN_MESSAGE }]);
  });

  test("forget durante un refresco no deja que el viejo borre al nuevo ni cachee", async () => {
    const release: (() => void)[] = [];
    let n = 0;
    const row: StoredGoogleAccount = {
      id: "acc_1",
      isActive: true,
      services: ["CALENDAR"],
      refreshTokenEnc: "sealed:rt-1",
      grantedScopes: [CALENDAR],
    };
    const fetches: number[] = [];
    const provider = createGoogleTokenProvider({
      client: () => CLIENT,
      fetchImpl: async () => {
        const id = ++n;
        fetches.push(id);
        await new Promise<void>((resolve) => release.push(resolve));
        return Response.json({ access_token: `at-${id}`, expires_in: 3600 });
      },
      store: {
        load: async () => ({ ...row }),
        markNeedsReauthorization: async () => undefined,
        saveRotatedRefreshToken: async () => undefined,
        open: (sealed) => sealed,
      },
    });
    const flush = () => new Promise((r) => setTimeout(r, 0));

    const first = provider.getAccountToken("acc_1", ["CALENDAR"]);
    await flush();
    provider.forget("acc_1");
    const second = provider.getAccountToken("acc_1", ["CALENDAR"]);
    await flush();
    expect(fetches).toEqual([1, 2]);

    // Termina el viejo: no puede quitar de en medio el refresco nuevo.
    release[0]();
    expect(await first).toBe("at-1");
    await flush();
    const third = provider.getAccountToken("acc_1", ["CALENDAR"]);
    await flush();
    expect(fetches).toEqual([1, 2]);

    release[1]();
    expect(await second).toBe("at-2");
    expect(await third).toBe("at-2");
    // Y lo cacheado es lo del refresco nuevo, no el del viejo.
    expect(await provider.getAccountToken("acc_1", ["CALENDAR"])).toBe("at-2");
    expect(fetches).toEqual([1, 2]);
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

  test("splitGrantedServices: de lo pedido, lo concedido y lo que no", () => {
    const DRIVE = SERVICE_SCOPES.DRIVE[0];
    expect(splitGrantedServices(["CALENDAR", "DRIVE"], ["openid", CALENDAR])).toEqual({
      granted: ["CALENDAR"],
      missing: ["DRIVE"],
    });
    expect(splitGrantedServices(["CALENDAR", "DRIVE"], [CALENDAR, DRIVE])).toEqual({
      granted: ["CALENDAR", "DRIVE"],
      missing: [],
    });
    expect(splitGrantedServices(["MEET"], ["openid"])).toEqual({ granted: [], missing: ["MEET"] });
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
    expect(url.searchParams.get("code_challenge")).toBeNull();
  });

  test("PKCE: la URL lleva code_challenge S256 y el intercambio el code_verifier", async () => {
    const url = new URL(
      buildAuthorizationUrl({
        client: CLIENT,
        services: ["CALENDAR"],
        state: "st",
        redirectUri: "https://www.dayanabeltran.com/api/admin/google/callback",
        codeChallenge: "challenge-abc",
      })
    );
    expect(url.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");

    let body = new URLSearchParams();
    await exchangeAuthorizationCode({
      client: CLIENT,
      code: "code-1",
      codeVerifier: "verifier-1",
      redirectUri: "https://www.dayanabeltran.com/api/admin/google/callback",
      fetchImpl: async (_url, init) => {
        body = new URLSearchParams(String(init?.body ?? ""));
        return Response.json({ access_token: "at", refresh_token: "rt" });
      },
    });
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("verifier-1");
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
