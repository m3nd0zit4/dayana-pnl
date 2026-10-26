import { describe, expect, test } from "bun:test";

import { mercadoPagoPayerName } from "./mercadopago-payments";

describe("mercadoPagoPayerName (Allison, 25-oct: PSE sin nombre en `payer`)", () => {
  test("con PSE el nombre viene en additional_info.payer", () => {
    expect(
      mercadoPagoPayerName({
        payer: { email: "allisonarango09@outlook.com" },
        additional_info: { payer: { first_name: "Ana Milena", last_name: "Loaiza" } },
      })
    ).toEqual({ firstName: "Ana Milena", lastName: "Loaiza" });
  });
  test("si `payer` lo trae, manda ese", () => {
    expect(
      mercadoPagoPayerName({ payer: { first_name: "Gina", last_name: "Sánchez" }, additional_info: { payer: { first_name: "Otra", last_name: "Persona" } } })
    ).toEqual({ firstName: "Gina", lastName: "Sánchez" });
  });
  test("sin nombre en ninguna parte: nada (la ficha sigue pidiéndolo)", () => {
    expect(mercadoPagoPayerName({ payer: { email: "x@y.co", first_name: "  " } })).toEqual({ firstName: undefined, lastName: undefined });
  });
});
