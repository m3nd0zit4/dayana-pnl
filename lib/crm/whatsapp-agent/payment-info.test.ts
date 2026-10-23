import { describe, expect, test } from "bun:test";

import { toMinor, withPaymentBlocks } from "./payment-info";

describe("withPaymentBlocks", () => {
  test("los datos van debajo, tal cual, con dos puntos en la frase", () => {
    expect(withPaymentBlocks("Claro, te comparto los datos para el pago", { details: ["Bancolombia\nCuenta: 123"], link: null })).toBe(
      "Claro, te comparto los datos para el pago:\n\nBancolombia\nCuenta: 123"
    );
    expect(withPaymentBlocks("Aquí tienes tu enlace:", { details: [], link: "https://x.co/pagar/abc" })).toBe("Aquí tienes tu enlace:\n\nhttps://x.co/pagar/abc");
  });
  test("detrás de un enlace no van dos puntos (Ruth, 23-oct: «…/comunidad:»)", () => {
    expect(withPaymentBlocks("Aquí la página: https://www.dayanabeltran.com/eventos-gratuitos", { details: [], link: null, links: ["https://chat.whatsapp.com/abc"] })).toBe(
      "Aquí la página: https://www.dayanabeltran.com/eventos-gratuitos\n\nhttps://chat.whatsapp.com/abc"
    );
  });
  test("sin datos, el mensaje queda igual; no repite lo que ya dice", () => {
    expect(withPaymentBlocks("Con gusto, Ana.", { details: [], link: null })).toBe("Con gusto, Ana.");
    expect(withPaymentBlocks("Cuenta: 123", { details: ["Cuenta: 123"], link: null })).toBe("Cuenta: 123");
  });
});

describe("toMinor", () => {
  test("COP en pesos enteros, el resto en centavos", () => {
    expect(toMinor(150000, "COP")).toBe(150000);
    expect(toMinor(80, "USD")).toBe(8000);
    expect(toMinor(null, "USD")).toBeNull();
    expect(toMinor(-5, "USD")).toBeNull();
  });
});
