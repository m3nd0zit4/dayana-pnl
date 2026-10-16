import { describe, expect, test } from "bun:test";

import { phoneFromWhatsAppId } from "./phone";

describe("phoneFromWhatsAppId", () => {
  test("México con el 1 viejo (Perlita, 15-oct-2026)", () => {
    expect(phoneFromWhatsAppId("5215574914048")).toEqual({ phoneE164: "+525574914048", phoneCountryIso: "MX" });
    expect(phoneFromWhatsAppId("525574914048")).toEqual({ phoneE164: "+525574914048", phoneCountryIso: "MX" });
  });

  test("otros países quedan tal cual", () => {
    expect(phoneFromWhatsAppId("573136169343")?.phoneE164).toBe("+573136169343");
    expect(phoneFromWhatsAppId("584163776566")?.phoneE164).toBe("+584163776566");
    expect(phoneFromWhatsAppId("5491123456789")?.phoneE164).toBe("+5491123456789");
    expect(phoneFromWhatsAppId("5511987654321")?.phoneE164).toBe("+5511987654321");
  });

  test("sin número", () => {
    expect(phoneFromWhatsAppId("PE.2290670648352185")).toBeNull();
    expect(phoneFromWhatsAppId("123")).toBeNull();
  });
});
