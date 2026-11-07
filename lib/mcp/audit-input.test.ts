import { describe, expect, test } from "bun:test";
import { sanitizeToolInput } from "./audit-input";

describe("sanitizeToolInput", () => {
  test("nunca guarda el código del pago", () => {
    expect(sanitizeToolInput({ enrollmentId: "e1", amountMinor: 1000, code: "123456" })).toEqual({
      enrollmentId: "e1",
      amountMinor: 1000,
      code: "[oculto]",
    });
    expect(sanitizeToolInput({ nested: { otpCode: "1", apiToken: "x" } })).toEqual({
      nested: { otpCode: "[oculto]", apiToken: "[oculto]" },
    });
  });

  test("recorta textos largos y listas", () => {
    const out = sanitizeToolInput({ body: "a".repeat(1000), ids: Array.from({ length: 50 }, (_, i) => i) }) as {
      body: string;
      ids: number[];
    };
    expect(out.body.length).toBe(301);
    expect(out.ids).toHaveLength(20);
  });
});
