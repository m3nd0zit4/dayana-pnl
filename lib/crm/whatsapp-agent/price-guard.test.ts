import { describe, expect, test } from "bun:test";
import { mentionsPrice, redactPrices } from "./price-guard";

describe("mentionsPrice", () => {
  test.each([
    "El paquete de 6 sesiones cuesta $1.200.000",
    "son 150.000 pesos",
    "la sesión vale 180 mil",
    "Te sale en 90 USD",
    "COP 250000",
    "el valor es 300",
    "quedaría en 1 millón",
    "precio: 120",
    "US$ 50 la sesión",
  ])("detecta «%s»", (t) => expect(mentionsPrice(t)).toBe(true));

  test.each([
    "Hola mi hermosa, ¿cómo estás?",
    "Te agendo el jueves 25 a las 3:00 p. m.",
    "La consulta gratis dura 15 minutos",
    "Son 6 sesiones, una por semana",
    "Nos vemos el 2 de octubre a las 10",
    "Tu sesión 3/6 es mañana",
    "Dayana te explica los valores en la llamada",
  ])("no confunde «%s»", (t) => expect(mentionsPrice(t)).toBe(false));
});

test("redactPrices borra montos y deja el resto", () => {
  expect(redactPrices("El de 6 sesiones cuesta $1.200.000 y el de 3 son 650 mil")).toBe(
    "El de 6 sesiones cuesta [precio] y el de 3 son [precio]"
  );
});
