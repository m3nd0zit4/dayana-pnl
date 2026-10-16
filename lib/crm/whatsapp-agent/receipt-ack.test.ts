import { describe, expect, test } from "bun:test";

import { isPaymentAck } from "./receipt-ack";

describe("isPaymentAck", () => {
  test("lo que Dayana responde de verdad", () => {
    expect(isPaymentAck("🎤 Mi hermosa, te bendigo, he recibido, mi bella, muchísimas gracias.")).toBe(true);
    expect(isPaymentAck("Hola mi hermosa, te bendigo muchísimas gracias mi bella recibido")).toBe(true);
    expect(isPaymentAck("Recibido, gracias")).toBe(true);
    expect(isPaymentAck("Ya me llegó, gracias 🙏")).toBe(true);
    expect(isPaymentAck("Recibí tu pago, bienvenida")).toBe(true);
    expect(isPaymentAck("Pago confirmado ✅")).toBe(true);
    expect(isPaymentAck("ya lo recibí mi bella")).toBe(true);
    expect(isPaymentAck("No te preocupes, ya lo recibí")).toBe(true);
  });

  test("recibir la foto no es recibir el dinero", () => {
    expect(isPaymentAck("Recibí tu comprobante, lo reviso")).toBe(false);
    expect(isPaymentAck("Recibido, lo veo y te confirmo")).toBe(false);
    expect(isPaymentAck("Recibido, Perlita. Ya le aviso a Dayana para que lo revise y te confirmamos.")).toBe(false);
    expect(isPaymentAck("Recibido, déjame revisar la cuenta")).toBe(false);
  });

  test("no confirma", () => {
    expect(isPaymentAck("Aún no me ha llegado")).toBe(false);
    expect(isPaymentAck("No lo he recibido todavía")).toBe(false);
    expect(isPaymentAck("Todavía no me llega, ya te aviso")).toBe(false);
    expect(isPaymentAck("aún no llega")).toBe(false);
    expect(isPaymentAck("¿Ya me llegó?")).toBe(false);
    expect(isPaymentAck("¿Lo recibiste?")).toBe(false);
    expect(isPaymentAck("Gracias por escribir, tu mensaje fue recibido. Te respondo pronto.")).toBe(false);
    expect(isPaymentAck("Un abrazo mi bella")).toBe(false);
    expect(isPaymentAck("Te bendigo")).toBe(false);
    expect(isPaymentAck(null)).toBe(false);
  });
});
