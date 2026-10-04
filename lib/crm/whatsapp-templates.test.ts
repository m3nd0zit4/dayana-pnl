import { describe, expect, test } from "bun:test";

import {
  STARTER_TEMPLATES,
  headerFormatOf,
  metaTemplateName,
  templateBodyProblem,
  toMetaBody,
} from "./whatsapp-templates";

describe("headerFormatOf (cabecera de la plantilla en 360dialog)", () => {
  test("cabecera IMAGE, como la crea el Hub", () => {
    expect(
      headerFormatOf({
        name: "masterclass_gratuita_20261004",
        components: [
          { type: "HEADER", format: "IMAGE" },
          { type: "BODY", text: "✨ *MASTERCLASS GRATUITA* ✨" },
        ],
      })
    ).toBe("IMAGE");
  });
  test("sin cabecera: null; cabecera sin format: TEXT; minúsculas", () => {
    expect(headerFormatOf({ components: [{ type: "BODY", text: "Hola {{1}}" }] })).toBeNull();
    expect(headerFormatOf({})).toBeNull();
    expect(headerFormatOf({ components: [{ type: "HEADER", text: "Hola" }] })).toBe("TEXT");
    expect(headerFormatOf({ components: [{ type: "header", format: "image" }] })).toBe("IMAGE");
  });
});

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

describe("plantillas de citas", () => {
  test("son de utilidad y cumplen las reglas de Meta sin palabras de venta", async () => {
    const { utilityCategoryWarning } = await import("./whatsapp-template-rules");
    for (const key of ["cita_confirmacion", "cita_recordatorio", "cita_reprogramar"]) {
      const t = STARTER_TEMPLATES.find((x) => x.key === key)!;
      expect(t.category).toBe("UTILITY");
      expect(templateBodyProblem(t.body)).toBeNull();
      expect(utilityCategoryWarning(t.category, t.body)).toBeNull();
    }
  });
});

describe("confirmación de inscripción a un evento gratuito", () => {
  test("es de utilidad, cumple las reglas de Meta y no tiene palabras de venta", () => {
    const t = STARTER_TEMPLATES.find((x) => x.key === "evento_gratis_confirmacion")!;
    expect(t).toBeDefined();
    expect(t.category).toBe("UTILITY");
    expect(templateBodyProblem(t.body)).toBeNull();
    expect(utilityCategoryWarning(t.category, t.body)).toBeNull();
    expect(toMetaBody(t.body).varNames).toEqual(["nombre", "evento", "fecha"]);
  });
});
