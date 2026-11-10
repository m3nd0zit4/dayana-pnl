import { describe, expect, test } from "bun:test";

import { isPrivatePath, redactPrivateUrl } from "./private-path";

const token = "aB3_-".repeat(7).slice(0, 32);

describe("páginas con un secreto en la dirección", () => {
  test("la página de la persona sí; la del embudo y sus vecinas no", () => {
    expect(isPrivatePath(`/llamada/${token}`)).toBe(true);
    expect(isPrivatePath(`/llamada/${token}/`)).toBe(true);
    expect(isPrivatePath("/llamada")).toBe(false);
    expect(isPrivatePath("/llamada/")).toBe(false);
    expect(isPrivatePath("/llamadas-gratis")).toBe(false);
    expect(isPrivatePath(null)).toBe(false);
  });

  test("la analítica recibe la dirección sin el secreto", () => {
    expect(redactPrivateUrl(`https://www.dayanabeltran.com/llamada/${token}?x=1`)).toBe("https://www.dayanabeltran.com/llamada/mi-llamada?x=1");
    expect(redactPrivateUrl("https://www.dayanabeltran.com/llamada?ref=enlaces")).toBe("https://www.dayanabeltran.com/llamada?ref=enlaces");
  });
});
