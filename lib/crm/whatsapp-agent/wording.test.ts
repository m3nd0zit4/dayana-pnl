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
    expect(polishReply("Con gusto. ¿Hay algo más en lo que te pueda ayudar hoy?")).toBe("Con gusto.");
  });
  test("nunca queda vacío", () => {
    expect(polishReply("¿Qué te trae por aquí?")).toBe("¿Qué te trae por aquí?");
  });
});

describe("sin apodos cariñosos ni corazones (tono serio y amable)", () => {
  test("se quitan siempre, aunque sea la primera vez", () => {
    expect(polishReply("Te bendigo, mi hermosa 💛")).toBe("Te bendigo");
    expect(polishReply("Mi hermosa, te bendigo 💛 Me alegra que estés aquí.")).toBe("Te bendigo. Me alegra que estés aquí.");
    expect(polishReply("Con gusto, mi bella. Un abrazo")).toBe("Con gusto. Un abrazo");
    expect(polishReply("Hola querida, ¿cómo estás?")).toBe("Hola, ¿cómo estás?");
    expect(polishReply("Querida, ya le aviso a Dayana.")).toBe("Ya le aviso a Dayana.");
    expect(polishReply("Gracias, cariño. Te escribo mañana.")).toBe("Gracias. Te escribo mañana.");
    expect(polishReply("Claro que sí, mi amor, ya te confirmo.")).toBe("Claro que sí, ya te confirmo.");
    expect(polishReply("Te bendigo, amiga!")).toBe("Te bendigo!");
    expect(polishReply("Hola linda, te cuento")).toBe("Hola, te cuento");
    expect(polishReply("Hola, linda.")).toBe("Hola.");
    expect(polishReply("Querida María, te escribo de parte de Dayana.")).toBe("María, te escribo de parte de Dayana.");
    expect(polishReply("Hola mi reina, ¿cómo vas?")).toBe("Hola, ¿cómo vas?");
  });
  test("no toca palabras que no son apodos", () => {
    expect(polishReply("Hola Bella, ¿cómo estás?")).toBe("Hola Bella, ¿cómo estás?");
    expect(polishReply("Hola Linda, te bendigo.")).toBe("Hola Linda, te bendigo.");
    expect(polishReply("Es una hermosa oportunidad para trabajar el amor propio.")).toBe(
      "Es una hermosa oportunidad para trabajar el amor propio."
    );
    expect(polishReply("Entiendo lo que has querido decir. Con cariño te acompañamos.")).toBe(
      "Entiendo lo que has querido decir. Con cariño te acompañamos."
    );
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
