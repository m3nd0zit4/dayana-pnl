import { describe, expect, test } from "bun:test";

import { checkedGender, withoutGuessedGender } from "./dossier-rules";

describe("withoutGuessedGender (Felicitas, 18-oct)", () => {
  test("se quita lo que adivinaba por el nombre, el resto queda", () => {
    expect(withoutGuessedGender("- Felicitas es mujer y se inscribió al webinar gratuito.\n- Agradeció la aceptación.")).toBe(
      "- Felicitas se inscribió al webinar gratuito.\n- Agradeció la aceptación."
    );
    expect(withoutGuessedGender("- Es hombre.\n- Vive en Quito.")).toBe("- Vive en Quito.");
    expect(withoutGuessedGender("- Género: femenino\n- Vive en Lima.")).toBe("- Vive en Lima.");
    expect(withoutGuessedGender("- Danilo tiene 48 años y siente miedo al qué dirán.")).toBe("- Danilo tiene 48 años y siente miedo al qué dirán.");
  });
});

describe("checkedGender: solo con sus propias palabras", () => {
  test("la cita está en lo que escribió", () => {
    expect(checkedGender({ genderSaid: "femenino", genderQuote: "«estoy cansada»" }, "Hola, la verdad estoy cansada de todo", null)).toEqual({
      genderSaid: "femenino",
      genderQuote: "estoy cansada",
    });
  });
  test("por el nombre o sin cita, no", () => {
    expect(checkedGender({ genderSaid: "femenino", genderQuote: "Felicitas" }, "Buenas tardes muchas gracias", null)).toEqual({ genderSaid: null, genderQuote: null });
    expect(checkedGender({ genderSaid: "femenino", genderQuote: null }, "estoy cansada", null)).toEqual({ genderSaid: null, genderQuote: null });
  });
  test("lo ya comprobado en la ficha anterior se conserva", () => {
    expect(checkedGender({ genderSaid: null, genderQuote: null }, "Gracias", { genderSaid: "masculino", genderQuote: "soy muy desconfiado" })).toEqual({
      genderSaid: "masculino",
      genderQuote: "soy muy desconfiado",
    });
  });
});
