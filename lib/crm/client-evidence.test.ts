import { describe, expect, test } from "bun:test";

import { findClientEvidence, type EvidenceMessage } from "./client-evidence";

const at = new Date("2026-06-01T15:00:00Z");
const inb = (body: string): EvidenceMessage => ({ direction: "INBOUND", body, sentAt: at });
const out = (body: string, extra: Partial<EvidenceMessage> = {}): EvidenceMessage => ({ direction: "OUTBOUND", body, sentAt: at, ...extra });

describe("findClientEvidence", () => {
  test("la persona dice que ya pagó: fuerte", () => {
    const ev = findClientEvidence([inb("Hola Dayana, ya te transferí, aquí está el comprobante")]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ who: "persona", strength: "strong" });
  });

  test("Dayana confirma el pago o habla de su sesión: fuerte", () => {
    expect(findClientEvidence([out("Recibí tu pago, mi bella. Bienvenida a tu proceso")])[0]?.strength).toBe("strong");
    expect(findClientEvidence([out("Te espero mañana para tu sesión 3")])[0]?.strength).toBe("strong");
  });

  test("preguntar cómo pagar es débil (puede ser una interesada)", () => {
    expect(findClientEvidence([inb("¿Puedo pagar por Nequi?")])[0]?.strength).toBe("weak");
  });

  test("los masivos y la IA no cuentan", () => {
    expect(findClientEvidence([out("Recibí tu pago", { source: "bulk:abc" }), out("Recibí tu pago", { isAutoReply: true })])).toEqual([]);
  });

  test("una interesada que pregunta el precio no tiene evidencia", () => {
    expect(findClientEvidence([inb("¿Cuánto cuesta la sesión?"), out("Te cuento en la llamada gratis")])).toEqual([]);
  });
});
