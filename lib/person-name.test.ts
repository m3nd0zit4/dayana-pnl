import { describe, expect, test } from "bun:test";

import { personFirstName, personFullName } from "./person-name";

describe("personFirstName", () => {
  test("perfiles reales que no son un nombre (octubre de 2026)", () => {
    expect(personFirstName("DIOS ES MI PROVEEDOR 🙏")).toBeNull();
    expect(personFirstName("en la universidad 🥰🥰🥰")).toBeNull();
    expect(personFirstName("SF")).toBeNull();
    expect(personFirstName("~")).toBeNull();
    expect(personFirstName("+57 300 123 4567")).toBeNull();
    expect(personFirstName("ana@correo.com")).toBeNull();
    expect(personFirstName("Mamá de Sofía")).toBeNull();
    expect(personFirstName("Uñas Beauty Shop")).toBeNull();
  });

  test("nombres de verdad, listos para saludar", () => {
    expect(personFirstName("ENNY jose")).toBe("Enny");
    expect(personFirstName("Evelyn anais Requejo lopez")).toBe("Evelyn");
    expect(personFirstName("samy")).toBe("Samy");
    expect(personFirstName("Leidy 🌸")).toBe("Leidy");
    expect(personFirstName("Dra. Ana López")).toBe("Ana");
    expect(personFirstName("María de los Ángeles")).toBe("María");
    expect(personFirstName("Jesús")).toBe("Jesús");
    expect(personFirstName("Gloria Esperanza")).toBe("Gloria");
    expect(personFirstName("McKenzie")).toBe("McKenzie");
  });

  test("nombre completo para la asistente", () => {
    expect(personFullName("ENNY jose 🙏")).toBe("Enny Jose");
    expect(personFullName("Juan pablo")).toBe("Juan Pablo");
    expect(personFullName("maría DE LOS ángeles")).toBe("María de los Ángeles");
    expect(personFullName("DIOS ES MI PROVEEDOR 🙏")).toBeNull();
    // Sin el tratamiento ni el punto.
    expect(personFullName("Dra. Ana López")).toBe("Ana López");
    expect(personFullName("Ana.")).toBe("Ana");
  });

  test("nombres largos o con palabras que también son cosas", () => {
    expect(personFirstName("María Fe")).toBe("María");
    expect(personFullName("Maria de la Fe")).toBe("Maria de la Fe");
    expect(personFirstName("María Fernanda de los Ángeles Pérez Gómez")).toBe("María");
  });

  test("vacío", () => {
    expect(personFirstName(null)).toBeNull();
    expect(personFirstName("   ")).toBeNull();
  });
});
