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

import { foldName, nameMatches, parseEventTitle, withPhone } from "./event-title";

describe("leer el título de una cita", () => {
  test("formato completo de Dayana", () => {
    expect(parseEventTitle("3/6 Laura Pérez +573001234567")).toEqual({ counter: "3/6", name: "Laura Pérez", phone: "573001234567" });
  });
  test("solo nombre", () => {
    expect(parseEventTitle("Laura")).toEqual({ counter: null, name: "Laura", phone: null });
  });
  test("consulta gratis con número con espacios", () => {
    expect(parseEventTitle("0/0 Ana María +52 1 55 1234 5678")).toEqual({ counter: "0/0", name: "Ana María", phone: "5215512345678" });
  });
  test("número sin + pero largo", () => {
    expect(parseEventTitle("Carlos 3001234567").phone).toBe("3001234567");
  });
  test("una hora o un 2/10 no es un teléfono", () => {
    expect(parseEventTitle("2/10 Pedro 10:30").phone).toBeNull();
  });
  test("agregar el número sin repetirlo", () => {
    expect(withPhone("3/6 Laura", "573001234567")).toBe("3/6 Laura +573001234567");
    expect(withPhone("3/6 Laura +573001234567", "573001234567")).toBe("3/6 Laura +573001234567");
  });
  test("comparar nombres", () => {
    expect(foldName("Ána  López!")).toBe("ana lopez");
    expect(nameMatches("Ana", "Ana María López")).toBe(true);
    expect(nameMatches("Ana López", "Ana María López")).toBe(true);
    expect(nameMatches("Ana Gómez", "Ana María López")).toBe(false);
  });
});
