import { expect, test } from "bun:test";
import { withDayanaWording } from "./wording";

test("«De nada» se vuelve «Con gusto»", () => {
  expect(withDayanaWording("De nada, mi hermosa")).toBe("Con gusto, mi hermosa");
  expect(withDayanaWording("¡De nada! Te bendigo")).toBe("¡Con gusto! Te bendigo");
  expect(withDayanaWording("Gracias a ti. de nada 💛")).toBe("Gracias a ti. Con gusto 💛");
  expect(withDayanaWording("Hola\nde nada")).toBe("Hola\nCon gusto");
});

test("no toca «de nada» dentro de una frase", () => {
  expect(withDayanaWording("No te preocupes de nada")).toBe("No te preocupes de nada");
});
