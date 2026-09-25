import { describe, expect, test } from "bun:test";
import { polishReply, softenForPrompt, withDayanaWording } from "./wording";

test("«De nada» se vuelve «Con gusto»", () => {
  expect(withDayanaWording("De nada, mi hermosa")).toBe("Con gusto, mi hermosa");
  expect(withDayanaWording("¡De nada! Te bendigo")).toBe("¡Con gusto! Te bendigo");
  expect(withDayanaWording("Gracias a ti. de nada 💛")).toBe("Gracias a ti. Con gusto 💛");
  expect(withDayanaWording("Hola\nde nada")).toBe("Hola\nCon gusto");
  expect(withDayanaWording("No te preocupes de nada")).toBe("No te preocupes de nada");
});

describe("frases que Dayana no usa", () => {
  test("¿Qué te trae por aquí?", () => {
    expect(polishReply("Hola Aida, te bendigo. ¿Qué te trae por aquí?")).toBe("Hola Aida, te bendigo.");
    expect(polishReply("Hola, te bendigo. Cuéntame, ¿qué te trae por aquí hoy? ¿Cómo estás?")).toBe(
      "Hola, te bendigo. ¿Cómo estás?"
    );
  });
  test("Qué alegría tenerte por aquí", () => {
    expect(polishReply("¡Qué alegría tenerte por aquí, Natalia! Cuéntame, ¿cómo estás?")).toBe("Cuéntame, ¿cómo estás?");
  });
  test("¿Hay algo más en lo que te pueda ayudar hoy?", () => {
    expect(polishReply("Con gusto, mi hermosa. ¿Hay algo más en lo que te pueda ayudar hoy?")).toBe(
      "Con gusto, mi hermosa."
    );
  });
  test("nunca queda vacío", () => {
    expect(polishReply("¿Qué te trae por aquí?")).toBe("¿Qué te trae por aquí?");
  });
});

describe("no repetir «hermosa» ni el corazón", () => {
  test("la primera vez se deja", () => {
    expect(polishReply("Te bendigo, mi hermosa 💛")).toBe("Te bendigo, mi hermosa 💛");
  });
  test("si ya se dijo en el chat, se quita", () => {
    const recent = ["Hola mi hermosa, te bendigo 💛"];
    expect(polishReply("Te bendigo, mi hermosa 💛", recent)).toBe("Te bendigo");
    expect(polishReply("Mi hermosa, te bendigo 💛 Me alegra que estés aquí.", recent)).toBe(
      "Te bendigo. Me alegra que estés aquí."
    );
    expect(polishReply("Con gusto, mi bella. Un abrazo", recent)).toBe("Con gusto. Un abrazo");
  });
  test("como mucho un apodo y un corazón por mensaje", () => {
    expect(polishReply("Mi hermosa, te bendigo 💛 Gracias, mi bella 💛")).toBe("Mi hermosa, te bendigo 💛 Gracias");
  });
  test("no toca palabras que no son apodos", () => {
    expect(polishReply("Hola Bella, ¿cómo estás?", ["mi hermosa"])).toBe("Hola Bella, ¿cómo estás?");
  });
});

test("lo que lee la IA va sin apodos ni corazones", () => {
  expect(softenForPrompt("Hola mi hermosa, te bendigo 💛 ¿Cómo estás?")).toBe("Hola, te bendigo. ¿Cómo estás?");
});

test("no rompe «p. m.»", () => {
  expect(polishReply("El jueves a las 3:00 p. m. hora de La Paz. ella te confirma.")).toBe(
    "El jueves a las 3:00 p. m. hora de La Paz. Ella te confirma."
  );
});
