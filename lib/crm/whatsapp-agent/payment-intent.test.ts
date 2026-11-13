import { describe, expect, test } from "bun:test";

import { sendsReceipt, wantsPaymentHelp } from "./payment-intent";

const inb = (body: string | null, attachments?: unknown) => ({ direction: "INBOUND", body, attachments });
const out = (body: string) => ({ direction: "OUTBOUND", body });

describe("wantsPaymentHelp (clientas: la IA solo ayuda con pagos)", () => {
  test("pide la cuenta, los datos o el enlace", () => {
    expect(wantsPaymentHelp([inb("Hola Dayana, ¿a qué cuenta te consigno la sesión?")])).toBe(true);
    expect(wantsPaymentHelp([inb("Me pasas el número de cuenta porfa")])).toBe(true);
    expect(wantsPaymentHelp([inb("¿Me mandas el link de pago?")])).toBe(true);
    expect(wantsPaymentHelp([inb("¿Cómo te pago desde Estados Unidos?")])).toBe(true);
    expect(wantsPaymentHelp([inb("¿Puedo pagar por Western Union?")])).toBe(true);
  });

  test("dice que pagó, un problema con el pago o manda la foto del comprobante", () => {
    expect(wantsPaymentHelp([inb("Ya te transferí, aquí el comprobante")])).toBe(true);
    expect(wantsPaymentHelp([inb("No me salió la transferencia")])).toBe(true);
    expect(wantsPaymentHelp([inb(null, [{ kind: "image", mimeType: "image/jpeg" }])])).toBe(true);
    expect(wantsPaymentHelp([inb(null, [{ kind: "document", mimeType: "application/pdf" }])])).toBe(true);
  });

  test("lo demás sigue siendo de Dayana", () => {
    expect(wantsPaymentHelp([inb("Hola Dayana, ¿a qué hora es mi sesión mañana?")])).toBe(false);
    expect(wantsPaymentHelp([inb("Me siento mucho mejor desde la última sesión")])).toBe(false);
    expect(wantsPaymentHelp([inb(null, [{ kind: "sticker", mimeType: "image/webp" }])])).toBe(false);
    expect(wantsPaymentHelp([inb(null, [{ kind: "audio", mimeType: "audio/ogg" }])])).toBe(false);
  });

  test("solo mira lo último que escribió (después de la última respuesta)", () => {
    expect(wantsPaymentHelp([inb("¿A qué cuenta te pago?"), out("Te paso los datos"), inb("Gracias, nos vemos el jueves")])).toBe(false);
  });
});

describe("sendsReceipt (13-nov: después de su llamada solo se recibe el comprobante)", () => {
  const burst = (body: string, attachments?: unknown) => [
    { direction: "OUTBOUND", body: "Aquí te envío el link de pago", attachments: [] },
    { direction: "INBOUND", body, attachments },
  ];
  test("comprobante o «ya pagué» sí; pedir el enlace o los datos, no; «Ok si sra», no", () => {
    expect(sendsReceipt(burst("Ya te transferí, te mando el comprobante"))).toBe(true);
    expect(sendsReceipt(burst("", [{ kind: "image" }]))).toBe(true);
    expect(sendsReceipt(burst("Ya pagué"))).toBe(true);
    expect(sendsReceipt(burst("Mándame el link de pago por favor"))).toBe(false);
    expect(sendsReceipt(burst("¿A qué cuenta consigno?"))).toBe(false);
    expect(sendsReceipt(burst("Ok si sra"))).toBe(false);
    expect(sendsReceipt([])).toBe(false);
  });
});
