import { describe, expect, test } from "bun:test";

import { pickExistingThread, whatsAppThreadCandidates } from "./whatsapp-thread";

describe("una persona, un chat", () => {
  test("candidatos: el id tal cual, sus variantes y los alternos", () => {
    expect(whatsAppThreadCandidates("525512345678", ["MX.123456789"])).toEqual([
      "525512345678",
      "5215512345678",
      "MX.123456789",
    ]);
  });

  test("sin chat previo no se elige nada (se usa el id que llegó)", () => {
    expect(pickExistingThread(["525512345678", "5215512345678"], [])).toBeNull();
  });

  test("el chat importado con 521 recibe el mensaje que llegó con 52", () => {
    expect(pickExistingThread(["525512345678", "5215512345678"], ["5215512345678"])).toBe("5215512345678");
  });

  test("si existen las dos formas, gana la que llegó", () => {
    expect(pickExistingThread(["525512345678", "5215512345678"], ["5215512345678", "525512345678"])).toBe(
      "525512345678"
    );
  });

  test("el eco con teléfono cae en el chat del id de usuario si ese es el que existe", () => {
    const candidates = whatsAppThreadCandidates("51987654321", ["PE.2290670648352185"]);
    expect(pickExistingThread(candidates, ["PE.2290670648352185"])).toBe("PE.2290670648352185");
  });
});
