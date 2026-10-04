import { describe, expect, test } from "bun:test";

import { deliveryLabel, personStatusLine, shortWhen } from "./whatsapp-delivery-labels";

const SENT_AT = "2026-10-04T09:16:00.000Z";
const ANSWERED_AT = "2026-10-04T10:00:00.000Z";

describe("personStatusLine", () => {
  test("sin ningún envío no hay línea («Sin WhatsApp»)", () => {
    expect(personStatusLine(null)).toBeNull();
    expect(personStatusLine(undefined)).toBeNull();
    expect(personStatusLine({ lastSentAt: null, lastStatus: null, answeredAt: null })).toBeNull();
  });

  test("si respondió después del envío, «Respondió» con la hora de su respuesta", () => {
    expect(personStatusLine({ lastSentAt: SENT_AT, lastStatus: "READ", answeredAt: ANSWERED_AT })).toEqual({
      label: "Respondió",
      tone: "answered",
      at: ANSWERED_AT,
    });
  });

  test("las mismas palabras que el chat para cada estado de WhatsApp", () => {
    for (const status of ["SENT", "DELIVERED", "READ", "PENDING", null]) {
      const line = personStatusLine({ lastSentAt: SENT_AT, lastStatus: status, answeredAt: null });
      expect(line?.label).toBe(deliveryLabel(status).label);
      expect(line?.tone).toBe(deliveryLabel(status).tone);
      expect(line?.at).toBe(SENT_AT);
    }
    expect(personStatusLine({ lastSentAt: SENT_AT, lastStatus: "DELIVERED", answeredAt: null })?.label).toBe(
      "Le llegó"
    );
  });

  test("un fallo dice «No le llegó» sin el motivo (no cabe en la fila)", () => {
    expect(personStatusLine({ lastSentAt: SENT_AT, lastStatus: "FAILED", answeredAt: null })).toEqual({
      label: "No le llegó",
      tone: "fail",
      at: SENT_AT,
    });
  });

  test("el estado en minúsculas también vale", () => {
    expect(personStatusLine({ lastSentAt: SENT_AT, lastStatus: "read", answeredAt: null })?.tone).toBe("read");
  });
});

describe("shortWhen", () => {
  test("día, mes corto y hora, sin «de», en la zona pedida", () => {
    const text = shortWhen(SENT_AT, "America/Bogota").replace(/\s/g, " ");
    expect(text).toBe("4 oct, 4:16 a. m.");
  });

  test("la zona cambia el día cuando toca", () => {
    const text = shortWhen("2026-10-04T03:00:00.000Z", "America/Bogota").replace(/\s/g, " ");
    expect(text.startsWith("3 oct, ")).toBe(true);
  });
});
