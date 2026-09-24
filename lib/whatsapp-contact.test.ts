import { describe, expect, test } from "bun:test";

import { buildContactWhatsAppUrl, isWhatsAppUserId, whatsAppDigits, whatsAppRecipient } from "./whatsapp-contact";

describe("whatsAppDigits", () => {
  test("México: 52 + 10 dígitos → 521 (como llegan los chats)", () => {
    expect(whatsAppDigits("+529514733665")).toBe("5219514733665");
    expect(whatsAppDigits("+5219514733665")).toBe("5219514733665");
  });
  test("Argentina: el 9 de los celulares", () => {
    expect(whatsAppDigits("+542975808165")).toBe("5492975808165");
    expect(whatsAppDigits("+5492975808165")).toBe("5492975808165");
  });
  test("el resto, igual", () => {
    expect(whatsAppDigits("+573107785255")).toBe("573107785255");
    expect(whatsAppDigits("+17872121759")).toBe("17872121759");
    expect(whatsAppDigits("+5511931474505")).toBe("5511931474505");
  });
  test("wa.me usa el número de WhatsApp", () => {
    expect(buildContactWhatsAppUrl("+529514733665", "Hola")).toBe("https://wa.me/5219514733665?text=Hola");
  });
});

describe("usuarios sin número (BSUID)", () => {
  test("el caso de Emily va con recipient, no como número", () => {
    expect(isWhatsAppUserId("PE.2290670648352185")).toBe(true);
    expect(whatsAppRecipient("PE.2290670648352185")).toEqual({ recipient: "PE.2290670648352185" });
    expect(whatsAppRecipient("US.ENT.11815799212886844830")).toEqual({ recipient: "US.ENT.11815799212886844830" });
  });
  test("un número sigue yendo con to", () => {
    expect(isWhatsAppUserId("573107785255")).toBe(false);
    expect(whatsAppRecipient("573107785255")).toEqual({ to: "573107785255" });
  });
});
