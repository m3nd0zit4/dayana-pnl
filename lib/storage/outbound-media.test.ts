import { describe, expect, test } from "bun:test";

import { isOutboundMediaUrl } from "./outbound-media";

describe("isOutboundMediaUrl", () => {
  test("una copia guardada por el CRM", () => {
    expect(
      isOutboundMediaUrl("https://abc123.private.blob.vercel-storage.com/inbox/outbound/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab.jpg")
    ).toBe(true);
  });

  test("cualquier otro enlace, no", () => {
    expect(isOutboundMediaUrl("https://evil.example.com/inbox/outbound/a.jpg")).toBe(false);
    expect(isOutboundMediaUrl("http://abc.private.blob.vercel-storage.com/inbox/outbound/a.jpg")).toBe(false);
    expect(isOutboundMediaUrl("https://abc.private.blob.vercel-storage.com/otros/a.jpg")).toBe(false);
    expect(isOutboundMediaUrl("https://abc.private.blob.vercel-storage.com/inbox/outbound/../a.jpg")).toBe(false);
    expect(isOutboundMediaUrl("no es una url")).toBe(false);
  });
});
