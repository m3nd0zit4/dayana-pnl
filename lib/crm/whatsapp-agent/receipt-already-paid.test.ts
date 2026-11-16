import { describe, expect, test } from "bun:test";

import { alreadyPaidReply, alreadyPaidToolNote, claimsPaymentConfirmed, paymentReviewReply } from "./receipt-already-paid";
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

describe("alreadyPaidReply (dueña, 15-nov: solo Dayana confirma pagos)", () => {
  test("Ana Villalvazo: recibido y Dayana lo revisa, nunca «ya quedó registrado ✅»", () => {
    const text = alreadyPaidReply("Ana", { product: "Terapia Basica 3", productKind: "THERAPY" });
    expect(text).toBe("¡Gracias, Ana! 🙏 Recibí tu comprobante. Dayana revisa tu pago y te confirma por aquí. No tienes que enviar nada más.");
    expect(text).not.toMatch(/registrad|confirmad|✅/i);
    expect(claimsPaymentConfirmed(text)).toBe(false);
  });

  test("taller: Dayana revisa el pago del taller, sin «cupo separado» ni «inscrita»", () => {
    const text = alreadyPaidReply("Victorino", { product: "Sana Tu Relación con el Dinero", productKind: "WORKSHOP" });
    expect(text).toBe(
      "¡Gracias, Victorino! 🙏 Recibí tu comprobante. Dayana revisa tu pago del taller «Sana Tu Relación con el Dinero» y te confirma por aquí. No tienes que enviar nada más."
    );
    expect(text).not.toMatch(/inscrit[ao]|separado|registrad/i);
  });

  test("sin nombre seguro", () => {
    expect(paymentReviewReply(null)).toBe("¡Gracias! 🙏 Recibí tu comprobante. Dayana revisa tu pago y te confirma por aquí. No tienes que enviar nada más.");
  });

  test("la nota para el modelo prohíbe confirmar", () => {
    expect(alreadyPaidToolNote("PayPal · 63,74 USD")).toContain("PayPal · 63,74 USD");
    expect(alreadyPaidToolNote("x")).toContain("NO digas que el pago está confirmado");
  });
});

describe("claimsPaymentConfirmed", () => {
  test.each([
    "¡Gracias, Ana! 🙏 Tu pago por el enlace ya quedó registrado ✅ No tienes que enviar nada más.",
    "Listo, tu pago ya está confirmado.",
    "Tu pago fue aprobado, gracias.",
    "Ya recibimos tu pago 🙏",
    "Confirmé tu pago, nos vemos el lunes.",
    "Pago confirmado ✅",
    "Tu pago ya entró, quedas lista.",
    "Gracias, tu pago se registró correctamente.",
  ])("lo da por confirmado: %s", (text) => {
    expect(claimsPaymentConfirmed(text)).toBe(true);
  });

  test.each([
    "Recibí tu comprobante. Dayana revisa tu pago y te confirma por aquí.",
    "Cuando Dayana confirme tu pago te escribe para agendar.",
    "Apenas Dayana verifique tu pago confirmado te aviso.",
    "Tan pronto tu pago quede registrado, Dayana te agenda.",
    "Si tu pago ya está confirmado, Dayana te escribe.",
    "Aquí tienes el enlace de pago.",
    "Dayana te confirma por aquí cuando lo revise.",
  ])("no lo da por confirmado: %s", (text) => {
    expect(claimsPaymentConfirmed(text)).toBe(false);
  });
});
