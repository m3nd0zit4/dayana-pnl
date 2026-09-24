import { describe, expect, test } from "bun:test";

import { STARTER_TEMPLATES, metaTemplateName, toMetaBody } from "./whatsapp-templates";

describe("plantillas", () => {
  test("{{nombre}} → {{1}} en orden, repetidos reutilizan el número", () => {
    expect(toMetaBody("Hola {{nombre}}, {{evento}} el {{fecha}}. {{nombre}}")).toEqual({
      text: "Hola {{1}}, {{2}} el {{3}}. {{1}}",
      varNames: ["nombre", "evento", "fecha"],
    });
  });

  test("nombre válido para Meta", () => {
    expect(metaTemplateName("Evento Gratis: Invitación!")).toBe("evento_gratis_invitacion");
  });

  test("las plantillas iniciales tienen ejemplo para cada variable", () => {
    for (const t of STARTER_TEMPLATES) {
      const { varNames } = toMetaBody(t.body);
      for (const v of varNames) expect(t.example[v]).toBeTruthy();
    }
  });
});
