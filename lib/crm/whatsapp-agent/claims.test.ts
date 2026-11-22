import { describe, expect, test } from "bun:test";

import { claimsDayanaAction, methodFor, methodNamedIn, promisesPaymentData, withoutUnbackedDayanaClaims, type PayMethod } from "./claims";

const BANCOLOMBIA: PayMethod = { key: "bancolombia", label: "Bancolombia", when: "Pagos desde Colombia", details: "Bancolombia\nN° Cuenta: 1" };
const WU: PayMethod = { key: "western-union", label: "Western Union – Banco Unión", when: "Pagos desde fuera de Colombia", details: "WU\nN°: 2" };
const METHODS = [BANCOLOMBIA, WU];

describe("promesa de datos de pago (Gissella, Yuri)", () => {
  test.each([
    "Claro, te comparto los datos de Western Union para el pago.",
    "Ya te paso la información de pago.",
    "Aquí están los datos para que realices el pago:",
    "Te mando el número de cuenta.",
  ])("promete: %s", (t) => {
    expect(promisesPaymentData(t)).toBe(true);
  });
  test.each(["Cuando hagas el pago me mandas el comprobante.", "Dayana te explica los valores en la llamada.", "Te comparto los espacios disponibles"])(
    "no: %s",
    (t) => {
      expect(promisesPaymentData(t)).toBe(false);
    }
  );
});

describe("qué forma de pago le toca", () => {
  test("la que nombra por su palabra principal («Western Union», no el nombre completo)", () => {
    expect(methodNamedIn("te comparto los datos de Western Union", METHODS)?.key).toBe("western-union");
    expect(methodNamedIn("los datos de Bancolombia", METHODS)?.key).toBe("bancolombia");
  });
  test("sin nombrarla: por su país; sin país, no se adivina", () => {
    expect(methodFor("te comparto los datos", METHODS, "CO")?.key).toBe("bancolombia");
    expect(methodFor("te comparto los datos", METHODS, "MX")?.key).toBe("western-union");
    expect(methodFor("te comparto los datos", METHODS, null)).toBeNull();
    expect(methodFor("te comparto los datos", [BANCOLOMBIA], null)?.key).toBe("bancolombia");
  });
});

describe("lo que Dayana hizo o pidió, sin respaldo (Judith, Negra)", () => {
  test("la frase no sale; el resto sí", () => {
    const text = "Hola Judith. Dayana me pidió que te confirmara el depósito del lunes. Cualquier duda me escribes.";
    expect(claimsDayanaAction(text)).toBe(true);
    expect(withoutUnbackedDayanaClaims(text, false)).toEqual({ text: "Hola Judith. Cualquier duda me escribes.", removed: true });
    expect(withoutUnbackedDayanaClaims("Dayana intentó comunicarse contigo hace un rato.", false).text).toBe("");
  });
  test("con una instrucción de Dayana para el chat, sí", () => {
    expect(withoutUnbackedDayanaClaims("Dayana me pidió que te confirmara el depósito.", true).removed).toBe(false);
  });
  test.each(["Dayana te llama por WhatsApp a las 3:00 p. m.", "Dayana revisa tu pago y te confirma por aquí.", "Le aviso a Dayana."])("no es una afirmación: %s", (t) => {
    expect(claimsDayanaAction(t)).toBe(false);
  });
});
