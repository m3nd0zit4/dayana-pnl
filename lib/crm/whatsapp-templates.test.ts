import { describe, expect, test } from "bun:test";

import { STARTER_TEMPLATES, metaTemplateName, templateBodyProblem, toMetaBody } from "./whatsapp-templates";

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

describe("templateBodyProblem", () => {
  test("every starter passes Meta's rules", () => {
    for (const t of STARTER_TEMPLATES) expect(templateBodyProblem(t.body)).toBeNull();
  });
  test("rejects dangling or adjacent variables", () => {
    expect(templateBodyProblem("Hola, entra aquí: {{enlace}}")).toContain("terminar");
    expect(templateBodyProblem("Hola, entra aquí: {{enlace}}.")).toContain("terminar");
    expect(templateBodyProblem("{{nombre}}, hola")).toContain("empezar");
    expect(templateBodyProblem("Hola {{nombre}} {{evento}} ya")).toContain("seguidas");
  });
});

import { utilityCategoryWarning } from "./whatsapp-template-rules";

describe("categoría de utilidad", () => {
  test("palabras de venta en UTILIDAD avisan (Meta la pasaría a Marketing)", () => {
    expect(utilityCategoryWarning("UTILITY", "Hola, aprovecha el descuento de hoy")).toContain("Marketing");
    expect(utilityCategoryWarning("UTILITY", "Hola, te recuerdo tu cita de mañana")).toBeNull();
    expect(utilityCategoryWarning("MARKETING", "Hola, aprovecha el descuento")).toBeNull();
  });
});
