import { describe, expect, test } from "bun:test";

import { familyPaidReply, paidForFamily } from "./family-paid";

describe("paidForFamily (Malka, 28-oct)", () => {
  test("lo que escribió Malka, en mensajes cortos", () => {
    expect(paidForFamily(["Porq decidi", "Pagarle", "A mi hija primeo", "Mañana", "Tiene su primera cita", "Con usted"])).toBe(true);
  });

  test.each([
    "Le pagué a mi hijo las sesiones",
    "Mi hija ya tiene su primera cita con Dayana",
    "Mi esposo empieza mañana su terapia con usted",
    "Ya pagué lo de mi mamá",
  ])("pagó por alguien de su familia o ya empezó: %s", (text) => {
    expect(paidForFamily([text])).toBe(true);
  });

  test.each([
    "No tengo para pagarle a mi hija el colegio",
    "Mi hija quiere terapia también",
    "Ya pagué",
    "Entraré al próximo taller",
    "Mi mamá está enferma",
  ])("no es un pago por su familia: %s", (text) => {
    expect(paidForFamily([text])).toBe(false);
  });

  test("la respuesta se lo pasa a Dayana sin pedir otro pago", () => {
    expect(familyPaidReply("Malka")).toMatch(/^Gracias por contarme, Malka/);
    expect(familyPaidReply(null)).not.toMatch(/pago|comprobante|enlace/);
  });
});
