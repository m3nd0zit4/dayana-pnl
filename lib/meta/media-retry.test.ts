import { describe, expect, test } from "bun:test";

import { needsRetry } from "./media-retry";

describe("reintento de archivos", () => {
  const base = { kind: "image", url: null, mimeType: "image/jpeg", caption: null, mediaId: "m1" };
  test("un archivo sin guardar y con id se reintenta", () => {
    expect(needsRetry(base)).toBe(true);
  });
  test("no se reintenta lo guardado, lo vencido, lo sin id ni lo agotado", () => {
    expect(needsRetry({ ...base, url: "https://x" })).toBe(false);
    expect(needsRetry({ ...base, unavailableReason: "expired" })).toBe(false);
    expect(needsRetry({ ...base, mediaId: undefined })).toBe(false);
    expect(needsRetry({ ...base, retries: 6 })).toBe(false);
  });
  test("respeta la espera hasta el próximo intento", () => {
    const now = Date.now();
    expect(needsRetry({ ...base, retries: 1, retryAt: new Date(now + 60_000).toISOString() }, now)).toBe(false);
    expect(needsRetry({ ...base, retries: 1, retryAt: new Date(now - 1).toISOString() }, now)).toBe(true);
  });
});
