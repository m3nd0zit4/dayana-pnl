import { describe, expect, test } from "bun:test";

import { phoneHash } from "./whatsapp-ignored-numbers";

describe("phoneHash", () => {
  test("la misma huella para todas las formas del número", () => {
    expect(phoneHash("+52 55 1234 5678")).toBe(phoneHash("5215512345678"));
    expect(phoneHash("5511987654321")).toBe(phoneHash("551187654321"));
  });

  test("números distintos, huellas distintas, y nunca el número en claro", () => {
    const a = phoneHash("573001112233");
    expect(a).not.toBe(phoneHash("573001112234"));
    expect(a).not.toContain("573001112233");
  });

  test("un id de usuario o algo que no es número no tiene huella", () => {
    expect(phoneHash("PE.2290670648352185")).toBeNull();
    expect(phoneHash("123")).toBeNull();
  });
});
