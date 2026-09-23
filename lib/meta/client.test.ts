import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  DIALOG360_ACCOUNT,
  DIALOG360_HOST,
  graphFetchMedia,
  graphGet,
  graphPost,
} from "./client";

const realFetch = globalThis.fetch;

const captureFetch = () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("proveedor de WhatsApp en el cliente de Meta", () => {
  test("Meta directo: graph.facebook.com con el phone_number_id y Bearer", async () => {
    const calls = captureFetch();
    await graphPost("1234/messages", { a: 1 }, { token: "tok", provider: "meta" });
    expect(calls[0].url).toMatch(/^https:\/\/graph\.facebook\.com\/v[\d.]+\/1234\/messages$/);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["D360-API-KEY"]).toBeUndefined();
  });

  test("sin proveedor se comporta como Meta directo", async () => {
    const calls = captureFetch();
    await graphPost("1234/messages", {}, { token: "tok" });
    expect(calls[0].url).toContain("graph.facebook.com");
  });

  test("360dialog: su host, sin id en la ruta y con D360-API-KEY", async () => {
    const calls = captureFetch();
    await graphPost(`${DIALOG360_ACCOUNT}/messages`, { a: 1 }, { token: "key360", provider: "dialog360" });
    expect(calls[0].url).toBe(`${DIALOG360_HOST}/messages`);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["D360-API-KEY"]).toBe("key360");
    expect(headers.Authorization).toBeUndefined();
  });

  test("360dialog: consulta de un medio por id", async () => {
    const calls = captureFetch();
    await graphGet("media-99", {}, { token: "key360", provider: "dialog360" });
    expect(calls[0].url).toBe(`${DIALOG360_HOST}/media-99`);
  });

  test("360dialog: la descarga de medios pasa por el host del socio", async () => {
    const calls = captureFetch();
    await graphFetchMedia(
      "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",
      { token: "key360", provider: "dialog360" }
    );
    expect(calls[0].url).toBe(`${DIALOG360_HOST}/whatsapp_business/attachments/?mid=1`);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["D360-API-KEY"]).toBe("key360");
  });
});
