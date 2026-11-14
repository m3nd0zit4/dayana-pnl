import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { GoogleService } from "@prisma/client";
import {
  createOAuthPkce,
  encodePkceCookie,
  pkceChallenge,
  readPkceCookie,
  safeReturnPath,
  signOAuthState,
  STATE_TTL_MS,
  verifyOAuthState,
} from "./oauth-state";

const ORIGINAL_SECRET = process.env.AUTH_SECRET;
beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-google-oauth-state-0123456789";
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIGINAL_SECRET;
});

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const input = {
  accountId: "acc_1",
  staffUserId: "staff_1",
  services: ["CALENDAR", "DRIVE"] as GoogleService[],
  nonce: "nonce-1",
  returnTo: "/admin/ajustes/integraciones",
};

describe("state firmado del consentimiento de Google", () => {
  test("firma y verifica", () => {
    const state = signOAuthState(input, NOW);
    expect(verifyOAuthState(state, NOW + 1000)).toEqual({
      ...input,
      exp: NOW + STATE_TTL_MS,
    });
  });

  test("caduca a los 15 minutos", () => {
    const state = signOAuthState(input, NOW);
    expect(verifyOAuthState(state, NOW + STATE_TTL_MS - 1)).not.toBeNull();
    expect(verifyOAuthState(state, NOW + STATE_TTL_MS)).toBeNull();
  });

  test("un payload manipulado no verifica", () => {
    const [, signature] = signOAuthState(input, NOW).split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...input, accountId: "acc_otra", exp: NOW + STATE_TTL_MS }),
      "utf8"
    ).toString("base64url");
    expect(verifyOAuthState(`${forged}.${signature}`, NOW)).toBeNull();
  });

  test("una firma manipulada no verifica", () => {
    const state = signOAuthState(input, NOW);
    const last = state.at(-1) === "A" ? "B" : "A";
    expect(verifyOAuthState(`${state.slice(0, -1)}${last}`, NOW)).toBeNull();
    expect(verifyOAuthState(`${state.split(".")[0]}.`, NOW)).toBeNull();
    expect(verifyOAuthState(`${state}.extra`, NOW)).toBeNull();
  });

  test("otro AUTH_SECRET no verifica", () => {
    const state = signOAuthState(input, NOW);
    process.env.AUTH_SECRET = "otro-secreto-completamente-distinto-0123456789";
    try {
      expect(verifyOAuthState(state, NOW)).toBeNull();
    } finally {
      process.env.AUTH_SECRET = "test-secret-for-google-oauth-state-0123456789";
    }
  });

  test("vacío o basura no verifica", () => {
    expect(verifyOAuthState(null, NOW)).toBeNull();
    expect(verifyOAuthState("", NOW)).toBeNull();
    expect(verifyOAuthState("no-es-un-state", NOW)).toBeNull();
  });

  test("sin AUTH_SECRET no firma", () => {
    const saved = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      expect(() => signOAuthState(input, NOW)).toThrow();
    } finally {
      process.env.AUTH_SECRET = saved;
    }
  });

  test("returnTo solo admite rutas internas", () => {
    expect(safeReturnPath("/admin/ajustes/integraciones", "/x")).toBe("/admin/ajustes/integraciones");
    expect(safeReturnPath("/admin/x?google=1#g", "/x")).toBe("/admin/x?google=1#g");
    expect(safeReturnPath("https://evil.example", "/x")).toBe("/x");
    expect(safeReturnPath("//evil.example", "/x")).toBe("/x");
    expect(safeReturnPath("/\\evil.example", "/x")).toBe("/x");
    // El parser de URL quita tabuladores y saltos: «/\t/evil» sería «//evil».
    expect(safeReturnPath("/\t/evil.example", "/x")).toBe("/x");
    expect(safeReturnPath("/\n/evil.example", "/x")).toBe("/x");
    expect(safeReturnPath("/\r/evil.example", "/x")).toBe("/x");
    expect(safeReturnPath("/ /evil.example", "/x")).toBe("/x");
    expect(safeReturnPath("/\u0000/evil.example", "/x")).toBe("/x");
    expect(safeReturnPath(42, "/x")).toBe("/x");
    const state = signOAuthState({ ...input, returnTo: "//evil.example" }, NOW);
    expect(verifyOAuthState(state, NOW)?.returnTo).toBe("/admin/ajustes/integraciones");
  });

  test("un state sin nonce o con servicios desconocidos no verifica", () => {
    const noNonce = signOAuthState({ ...input, nonce: "" }, NOW);
    expect(verifyOAuthState(noNonce, NOW)).toBeNull();
    const badService = signOAuthState(
      { ...input, services: ["CALENDAR", "GMAIL" as GoogleService] },
      NOW
    );
    expect(verifyOAuthState(badService, NOW)).toBeNull();
  });
});

describe("PKCE y cookie de un solo navegador", () => {
  test("el challenge es el SHA-256 base64url del verifier", () => {
    const pkce = createOAuthPkce();
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkce.challenge).toBe(pkceChallenge(pkce.verifier));
    // Vector de RFC 7636, apéndice B.
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
    expect(createOAuthPkce().nonce).not.toBe(pkce.nonce);
  });

  test("la cookie solo da el verifier si su nonce es el del state", () => {
    const pkce = createOAuthPkce();
    const cookie = encodePkceCookie(pkce);
    expect(readPkceCookie(cookie, pkce.nonce)).toBe(pkce.verifier);
    // Un state filtrado en otro navegador: otra cookie o ninguna.
    expect(readPkceCookie(cookie, "otro-nonce")).toBeNull();
    expect(readPkceCookie(encodePkceCookie(createOAuthPkce()), pkce.nonce)).toBeNull();
    expect(readPkceCookie(undefined, pkce.nonce)).toBeNull();
    expect(readPkceCookie("", pkce.nonce)).toBeNull();
    expect(readPkceCookie(`${cookie}.extra`, pkce.nonce)).toBeNull();
  });
});
