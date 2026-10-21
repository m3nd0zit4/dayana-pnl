import { describe, expect, test } from "bun:test";

import { asksForBankDetails, dayanaPaymentLink, withoutPayUrls } from "./chat-payment-link";

const now = new Date("2026-10-21T15:20:00Z");
const at = (iso: string) => new Date(iso);
const dayana = (body: string, sentAt = at("2026-10-21T13:56:19Z")) => ({ direction: "OUTBOUND" as const, body, sentAt });
const ai = (body: string, sentAt = at("2026-10-21T14:58:01Z")) => ({ direction: "OUTBOUND" as const, body, isAutoReply: true, sentAt });
const inb = (body: string, sentAt = at("2026-10-21T15:14:08Z")) => ({ direction: "INBOUND" as const, body, sentAt });

describe("dayanaPaymentLink", () => {
  test("Paola: el enlace que Dayana mandó desde el celular", () => {
    const lines = [
      dayana("🎤 Hermosa, te voy a enviar el link de pago y mi website para que puedas mirar.", at("2026-10-21T13:55:58Z")),
      dayana("https://www.dayanabeltran.com/pagar/p/therapy-24"),
      ai("Hola Paola, ¿pudiste hablar con Dayana en tu llamada del miércoles, 21 de octubre? Responde SÍ o NO por aquí."),
      inb("Si"),
    ];
    expect(dayanaPaymentLink(lines, now)).toEqual({ url: "https://www.dayanabeltran.com/pagar/p/therapy-24", sentAt: at("2026-10-21T13:56:19Z") });
  });

  test("dentro de una frase, sin el punto final", () => {
    expect(dayanaPaymentLink([dayana("Aquí está tu link: https://www.dayanabeltran.com/pagar/abc123.")], now)?.url).toBe(
      "https://www.dayanabeltran.com/pagar/abc123"
    );
  });

  test("lo que mandó la asistente (curso, sesión urgente) no cuenta", () => {
    expect(dayanaPaymentLink([ai("Aquí puedes hacer el pago:\n\nhttps://www.dayanabeltran.com/pagar/p/course-live")], now)).toBeNull();
  });

  test("uno de hace más de 30 días ya no cuenta", () => {
    expect(dayanaPaymentLink([dayana("https://www.dayanabeltran.com/pagar/p/therapy-24", at("2026-09-10T13:00:00Z"))], now)).toBeNull();
  });

  test("sin enlace", () => {
    expect(dayanaPaymentLink([dayana("Hola Paola, te bendigo"), inb("Si")], now)).toBeNull();
  });
});

describe("withoutPayUrls", () => {
  test("el enlace copiado a mano sale del texto (también «Https://»)", () => {
    const r = withoutPayUrls("Como ya te compartió el enlace, puedes realizarlo directamente desde ahí:\nHttps://www.dayanabeltran.com/pagar/p/therapy-24\n\nMe mandas el comprobante por aquí.");
    expect(r.had).toBe(true);
    expect(r.text).toBe("Como ya te compartió el enlace, puedes realizarlo directamente desde ahí.\n\nMe mandas el comprobante por aquí.");
    expect(withoutPayUrls("Puedes pagar aquí: https://www.dayanabeltran.com/pagar/p/therapy-24").text).toBe("Puedes pagar aquí");
  });

  test("sin enlace no cambia nada", () => {
    expect(withoutPayUrls("Claro, Paola.")).toEqual({ text: "Claro, Paola.", had: false });
  });
});

describe("asksForBankDetails", () => {
  test("un «sí» o «quiero pagar» no pide la cuenta", () => {
    expect(asksForBankDetails(["Si"])).toBe(false);
    expect(asksForBankDetails(["Listo, ¿cómo pago?"])).toBe(false);
    expect(asksForBankDetails(["Quiero empezar, ya voy a pagar"])).toBe(false);
    expect(asksForBankDetails(["Me di cuenta de que necesito ayuda"])).toBe(false);
  });

  test("pide la cuenta, transferir u otro medio", () => {
    expect(asksForBankDetails(["¿Me pasas el número de cuenta?"])).toBe(true);
    expect(asksForBankDetails(["Prefiero hacer transferencia"])).toBe(true);
    expect(asksForBankDetails(["¿Tienes Nequi?"])).toBe(true);
    expect(asksForBankDetails(["Me pasas los datos para consignar"])).toBe(true);
    expect(asksForBankDetails(["Estoy en Venezuela, ¿puedo por Western Union?"])).toBe(true);
    expect(asksForBankDetails(["No tengo tarjeta"])).toBe(true);
  });

  test("el enlace no le sirve", () => {
    expect(asksForBankDetails(["El link no me deja pagar"])).toBe(true);
    expect(asksForBankDetails(["No me abre el enlace"])).toBe(true);
    expect(asksForBankDetails(["No pude pagar"])).toBe(true);
  });
});
