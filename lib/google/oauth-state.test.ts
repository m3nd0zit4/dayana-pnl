import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
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
    expect(safeReturnPath("https://evil.example", "/x")).toBe("/x");
    expect(safeReturnPath("//evil.example", "/x")).toBe("/x");
    expect(safeReturnPath("/\\evil.example", "/x")).toBe("/x");
    const state = signOAuthState({ ...input, returnTo: "//evil.example" }, NOW);
    expect(verifyOAuthState(state, NOW)?.returnTo).toBe("/admin/ajustes/integraciones");
  });
});
