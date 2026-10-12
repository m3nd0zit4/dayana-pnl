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

import { contactPhoneCandidates, whatsAppIdVariants } from "./whatsapp-contact";

describe("whatsAppIdVariants: el mismo número como id de chat", () => {
  test("México: 52 ↔ 521, la forma tal cual primero", () => {
    expect(whatsAppIdVariants("5215512345678")).toEqual(["5215512345678", "525512345678"]);
    expect(whatsAppIdVariants("525512345678")).toEqual(["525512345678", "5215512345678"]);
  });

  test("Argentina: 54 ↔ 549", () => {
    expect(whatsAppIdVariants("5491123456789")).toEqual(["5491123456789", "541123456789"]);
    expect(whatsAppIdVariants("541123456789")).toEqual(["541123456789", "5491123456789"]);
  });

  test("Brasil: celular con y sin el 9", () => {
    expect(whatsAppIdVariants("5511987654321")).toEqual(["5511987654321", "551187654321"]);
    expect(whatsAppIdVariants("551187654321")).toEqual(["551187654321", "5511987654321"]);
  });

  test("Brasil: un fijo no gana un 9 (sería otra persona)", () => {
    expect(whatsAppIdVariants("551133334444")).toEqual(["551133334444"]);
  });

  test("Colombia y el resto: una sola forma", () => {
    expect(whatsAppIdVariants("573001234567")).toEqual(["573001234567"]);
    expect(whatsAppIdVariants("+57 300 123 4567")).toEqual(["573001234567"]);
  });

  test("id de usuario (BSUID): sin variantes ni teléfono", () => {
    expect(whatsAppIdVariants("PE.2290670648352185")).toEqual(["PE.2290670648352185"]);
    expect(contactPhoneCandidates("PE.2290670648352185")).toEqual([]);
  });

  test("contactPhoneCandidates: E.164 de cada forma", () => {
    expect(contactPhoneCandidates("5215512345678")).toEqual(["+5215512345678", "+525512345678"]);
  });
});
