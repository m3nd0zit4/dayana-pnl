import { beforeEach, describe, expect, mock, test } from "bun:test";

process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-123";
process.env.GOOGLE_CONNECT_CONNECTOR = "oauth/google";

const settings = new Map<string, string>();
let connectCalls = 0;
let connectResult: () => Promise<{ token: string; expiresAt: number }> = async () => ({
  token: `fresh-${connectCalls}`,
  expiresAt: Date.now() + 60 * 60_000,
});

class UserAuthorizationRequiredError extends Error {}
class NoValidTokenError extends Error {}

mock.module("@vercel/connect", () => ({
  getTokenResponse: async () => {
    connectCalls++;
    return connectResult();
  },
  startAuthorization: async () => ({ url: "" }),
  UserAuthorizationRequiredError,
  NoValidTokenError,
}));

mock.module("@/lib/db", () => ({
  prisma: {
    googleAccount: {
      findUnique: async () => ({ id: "acc1", isActive: true, services: ["CALENDAR"], connectSubject: "sub1" }),
      update: async () => ({}),
    },
    siteSetting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        settings.has(where.key) ? { value: settings.get(where.key) } : null,
      upsert: async ({ where, create }: { where: { key: string }; create: { value: string } }) => {
        settings.set(where.key, create.value);
      },
    },
  },
}));

const { getAccountToken } = await import("./connect");

describe("getAccountToken: token compartido entre instancias (14-nov, «fair use» de Vercel Connect)", () => {
  beforeEach(() => {
    settings.clear();
    connectCalls = 0;
    connectResult = async () => ({ token: `fresh-${connectCalls}`, expiresAt: Date.now() + 60 * 60_000 });
  });

  test("lo pide una vez y lo reutiliza; se guarda cifrado", async () => {
    expect(await getAccountToken("acc1")).toBe("fresh-1");
    expect(await getAccountToken("acc1")).toBe("fresh-1");
    expect(connectCalls).toBe(1);
    const stored = [...settings.values()][0]!;
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored.includes("fresh-1")).toBe(false);
  });

  test("a punto de caducar pide otro", async () => {
    connectResult = async () => ({ token: `fresh-${connectCalls}`, expiresAt: Date.now() + 2 * 60_000 });
    await getAccountToken("acc1");
    await getAccountToken("acc1");
    expect(connectCalls).toBe(2);
  });

  test("Connect bloqueado: usa el compartido mientras valga", async () => {
    connectResult = async () => ({ token: "short", expiresAt: Date.now() + 3 * 60_000 });
    expect(await getAccountToken("acc1")).toBe("short");
    connectResult = async () => {
      throw new Error("Connect token requests are blocked until November 15, 2026 for exceeding the fair use limit.");
    };
    expect(await getAccountToken("acc1")).toBe("short");
  });

  test("sin compartido y Connect bloqueado: el error sale como antes", async () => {
    connectResult = async () => {
      throw new Error("blocked");
    };
    await expect(getAccountToken("acc1")).rejects.toThrow("blocked");
  });
});
