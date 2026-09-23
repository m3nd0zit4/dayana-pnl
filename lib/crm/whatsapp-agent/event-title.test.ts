import { describe, expect, test } from "bun:test";

import { buildEventTitle, isFreeCallService } from "./event-title";

describe("buildEventTitle", () => {
  test("con paquete: sesión que se agenda sobre el total", () => {
    expect(
      buildEventTitle({
        name: "Laura Pérez",
        phone: "573001234567",
        enrollment: { sessionsUsed: 2, sessionsTotal: 10 },
      })
    ).toBe("3/10 Laura Pérez +573001234567");
  });

  test("sin paquete: 0/0", () => {
    expect(buildEventTitle({ name: "Laura", phone: "+57 300 123 4567" })).toBe(
      "0/0 Laura +573001234567"
    );
  });

  test("consulta gratis va 0/0 aunque tenga paquete", () => {
    expect(
      buildEventTitle({
        name: "Laura",
        phone: "573001234567",
        enrollment: { sessionsUsed: 2, sessionsTotal: 10 },
        freeCall: true,
      })
    ).toBe("0/0 Laura +573001234567");
  });

  test("paquete completo no pasa del total; sin nombre, solo teléfono", () => {
    expect(
      buildEventTitle({
        name: null,
        phone: "51987654321",
        enrollment: { sessionsUsed: 10, sessionsTotal: 10 },
      })
    ).toBe("10/10 +51987654321");
  });

  test("detecta la consulta gratis", () => {
    expect(isFreeCallService("Consulta gratis 15 min", 15)).toBe(true);
    expect(isFreeCallService("Sesión de terapia", 60)).toBe(false);
  });
});
