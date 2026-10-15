import { describe, expect, test } from "bun:test";

import { alreadySaid, sameMessage } from "./repeat-guard";

describe("sameMessage", () => {
  test("el aviso repetido de la comunidad (14-oct)", () => {
    const a = "Déjame avisarle a Dayana para que te agregue al grupo de la comunidad.";
    const b = "Déjame avisarle a Dayana para que te agregue al grupo de la comunidad y te confirme por aquí.";
    expect(sameMessage(a, b)).toBe(true);
    expect(sameMessage(b, b)).toBe(true);
    expect(sameMessage("Déjame consultarlo con Dayana y te confirmo por aquí.", "Déjame consultarlo con Dayana y te confirmo por aqui")).toBe(true);
  });

  test("mensajes distintos", () => {
    expect(sameMessage("Tu llamada queda para el jueves 15 a las 10 de la mañana", "Tu llamada queda para el jueves 22 a las 10 de la mañana")).toBe(false);
    expect(sameMessage("Con gusto. Te bendigo.", "Con gusto, Ana.")).toBe(false);
    expect(
      sameMessage("Déjame consultarlo con Dayana y te confirmo por aquí.", "Claro, te comparto los datos para el pago. Cuando lo hagas, me mandas el comprobante.")
    ).toBe(false);
  });
});

describe("alreadySaid", () => {
  test("mira los mensajes recientes", () => {
    expect(alreadySaid("Déjame consultarlo con Dayana y te confirmo por aquí.", [null, "Hola", "Déjame consultarlo con Dayana y te confirmo por aquí."])).toBe(true);
    expect(alreadySaid("Déjame consultarlo con Dayana y te confirmo por aquí.", [])).toBe(false);
  });
});
