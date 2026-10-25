import { describe, expect, test } from "bun:test";

import { providerLabel, referenceCandidates } from "./receipt-web-payment";

describe("referenceCandidates: la referencia del comprobante como la guarda el pago (Gina, 25-oct)", () => {
  test("Mercado Pago: el número tal cual, sin espacios ni puntos", () => {
    expect(referenceCandidates("186059161400")).toEqual(["186059161400"]);
    expect(referenceCandidates("186 059 161 400")).toEqual(["186 059 161 400", "186059161400"]);
    expect(referenceCandidates("Ref. 186059161400")).toContain("186059161400");
  });
  test("PayPal: el id con letras, también en mayúsculas", () => {
    expect(referenceCandidates("3k618896mx137411d")).toContain("3K618896MX137411D");
  });
  test("sin referencia o muy corta: nada (no se adivina por el valor)", () => {
    expect(referenceCandidates(null)).toEqual([]);
    expect(referenceCandidates("12345")).toEqual([]);
  });
  test("providerLabel", () => {
    expect(providerLabel("MERCADO_PAGO")).toBe("Mercado Pago");
    expect(providerLabel("PAYPAL")).toBe("PayPal");
  });
});
