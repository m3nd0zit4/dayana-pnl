import { describe, expect, test } from "bun:test";

import { alreadyPaidReply, alreadyPaidToolNote } from "./receipt-already-paid";
import { likelySamePayment } from "./receipt-web-payment";

const paypal = { match: "person" as const, amountMinor: 6374, currency: "USD" };
const receipt = (r: Partial<Parameters<typeof likelySamePayment>[0]>) => ({
  method: null,
  amountMinor: null,
  currency: null,
  reference: null,
  ...r,
});

describe("likelySamePayment (dueña, 1-nov: pagó por el link → no se registra otra vez)", () => {
  test("la referencia del comprobante es el id del pago: siempre el mismo", () => {
    expect(likelySamePayment(receipt({ method: "Nequi", reference: "185032471745" }), { ...paypal, match: "reference" })).toBe(true);
  });

  test("Victorino: captura sin monto ni número, poco después de su PayPal", () => {
    expect(likelySamePayment(receipt({}), paypal)).toBe(true);
  });

  test("Natividad: «60 USD» y PayPal cobró 63.74 (la comisión)", () => {
    expect(likelySamePayment(receipt({ amountMinor: 6000, currency: "USD" }), paypal)).toBe(true);
  });

  test("el medio del comprobante es el de la página (PayPal, PSE, Mercado Pago) y el monto cuadra o no se ve", () => {
    expect(likelySamePayment(receipt({ method: "PayPal", amountMinor: 6374, currency: "USD" }), paypal)).toBe(true);
    expect(likelySamePayment(receipt({ method: "PSE (BBVA / Mercadopago)", reference: "186059161400" }), paypal)).toBe(true);
  });

  test("por PayPal pero otro monto: un segundo cobro, lo decide Dayana", () => {
    expect(likelySamePayment(receipt({ method: "PayPal", amountMinor: 3400, currency: "USD" }), paypal)).toBe(false);
  });

  test("otro medio (Nequi, Bancolombia) es otro pago, se lea o no el monto", () => {
    expect(likelySamePayment(receipt({ method: "Nequi", reference: "890811", amountMinor: 190000, currency: "COP" }), paypal)).toBe(false);
    expect(likelySamePayment(receipt({ method: "Bancolombia" }), paypal)).toBe(false);
  });

  test("un monto que no cuadra, o en otra moneda, lo decide Dayana", () => {
    expect(likelySamePayment(receipt({ amountMinor: 37000, currency: "USD" }), paypal)).toBe(false);
    expect(likelySamePayment(receipt({ amountMinor: 190000, currency: "COP" }), paypal)).toBe(false);
  });
});

describe("alreadyPaidReply", () => {
  test("taller: el cupo ya está separado, sin «inscrita» (no se adivina el género)", () => {
    const text = alreadyPaidReply("Victorino", { product: "Sana Tu Relación con el Dinero", productKind: "WORKSHOP" });
    expect(text).toBe(
      "¡Gracias, Victorino! 🙏 Tu pago por el enlace ya quedó registrado ✅ y tu cupo en el taller «Sana Tu Relación con el Dinero» ya está separado. No tienes que enviar nada más."
    );
    expect(text).not.toMatch(/inscrit[ao]|revisa/i);
  });

  test("sin nombre seguro y sin taller", () => {
    expect(alreadyPaidReply(null, { product: "Terapia 6", productKind: "THERAPY" })).toBe(
      "¡Gracias! 🙏 Tu pago por el enlace ya quedó registrado ✅ No tienes que enviar nada más."
    );
  });

  test("la nota para el modelo nombra el pago y le quita «Dayana lo revisa»", () => {
    expect(alreadyPaidToolNote("PayPal · 63,74 USD")).toContain("PayPal · 63,74 USD");
    expect(alreadyPaidToolNote("x")).toContain("No digas que Dayana lo revisa");
  });
});
