import { describe, expect, test } from "bun:test";
import {
  expiryFrom,
  generateMcpToken,
  hashMcpToken,
  isExpiryDays,
  looksLikeMcpToken,
  shouldTouchLastUsed,
  tokenDisplayPrefix,
  tokenStatus,
} from "./token-format";

describe("tokens MCP", () => {
  test("forma: dpnl_ + 32 bytes base64url", () => {
    const token = generateMcpToken();
    expect(token).toMatch(/^dpnl_[A-Za-z0-9_-]{43}$/);
    expect(looksLikeMcpToken(token)).toBe(true);
    expect(generateMcpToken()).not.toBe(token);
  });

  test("rechaza lo que no es un token nuestro", () => {
    expect(looksLikeMcpToken(undefined)).toBe(false);
    expect(looksLikeMcpToken("")).toBe(false);
    expect(looksLikeMcpToken("dpnl_short")).toBe(false);
    expect(looksLikeMcpToken(`xxxx_${"a".repeat(43)}`)).toBe(false);
    expect(looksLikeMcpToken(`dpnl_${"a".repeat(42)}=`)).toBe(false);
  });

  test("hash sha256 hex estable, prefijo de 12", () => {
    const token = `dpnl_${"a".repeat(43)}`;
    expect(hashMcpToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashMcpToken(token)).toBe(hashMcpToken(token));
    expect(tokenDisplayPrefix(token)).toBe("dpnl_aaaaaaa");
  });

  test("caducidad", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(expiryFrom(null, now)).toBeNull();
    expect(expiryFrom(30, now)?.toISOString()).toBe("2026-12-07T12:00:00.000Z");
    expect(isExpiryDays(90)).toBe(true);
    expect(isExpiryDays(7)).toBe(false);
  });

  test("estado", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(tokenStatus({ revokedAt: null, expiresAt: null }, now)).toBe("active");
    expect(tokenStatus({ revokedAt: null, expiresAt: new Date("2026-11-07T11:59:59Z") }, now)).toBe("expired");
    expect(tokenStatus({ revokedAt: new Date(), expiresAt: null }, now)).toBe("revoked");
  });

  test("lastUsedAt como mucho una vez por minuto", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(shouldTouchLastUsed(null, now)).toBe(true);
    expect(shouldTouchLastUsed(new Date("2026-11-07T11:59:30Z"), now)).toBe(false);
    expect(shouldTouchLastUsed(new Date("2026-11-07T11:58:59Z"), now)).toBe(true);
  });
});
