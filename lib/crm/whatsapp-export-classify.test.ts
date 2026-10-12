import { describe, expect, test } from "bun:test";

import { classifyExportRules, decideExport, detectBatchOwner, type ExportClassifyInput } from "./whatsapp-export-classify";

const chat = (lines: [string, string][], extra: Partial<ExportClassifyInput> = {}): ExportClassifyInput => ({
  authors: [...new Set(lines.map(([a]) => a))],
  dayanaAuthor: "Dayana",
  messages: lines.map(([author, body]) => ({ author, body })),
  ...extra,
});

describe("classifyExportRules", () => {
  test("una clienta que agenda y paga: trabajo, se importa", () => {
    const c = classifyExportRules(
      chat([
        ["Laura", "Hola Dayana, quiero agendar la llamada gratis"],
        ["Dayana", "Hola Laura, te bendigo. ¿Qué día te sirve para la sesión?"],
        ["Laura", "Ya te mandé el comprobante de la transferencia"],
      ])
    );
    expect(c.verdict).toBe("business");
    expect(decideExport(c)).toBe("import");
  });

  test("la familia: personal, no se importa", () => {
    const c = classifyExportRules(
      chat([
        ["Mamá", "Hija, ¿vienes el domingo al almuerzo?"],
        ["Dayana", "Sí mami, te amo. Llevo el postre para el almuerzo"],
      ])
    );
    expect(c.verdict).toBe("personal");
    expect(decideExport(c)).toBe("skip");
  });

  test("una clienta que habla de su mamá sigue siendo trabajo (lo personal cuenta en lo de Dayana)", () => {
    const c = classifyExportRules(
      chat([
        ["Ana", "Mi mamá me dejó cuando era niña y siento ansiedad"],
        ["Dayana", "Te entiendo. En la sesión trabajamos tu niño interior; ¿agendamos la llamada gratis?"],
        ["Ana", "Sí, ¿cuánto cuesta el paquete?"],
      ])
    );
    expect(c.verdict).toBe("business");
  });

  test("el CRM ya sabe que pagó: trabajo aunque el chat sea corto", () => {
    expect(classifyExportRules(chat([["Pedro", "Hola"], ["Dayana", "Hola Pedro"]], { crm: { hasPayment: true } })).verdict).toBe(
      "business"
    );
  });

  test("grupo, equipo y vacío se saltan", () => {
    expect(decideExport(classifyExportRules(chat([["A", "hola"], ["B", "hola"], ["Dayana", "hola"]])))).toBe("skip");
    expect(decideExport(classifyExportRules(chat([["Sara", "hola"], ["Dayana", "dime"]], { crm: { isTeam: true } })))).toBe(
      "skip"
    );
    expect(decideExport(classifyExportRules(chat([["Sara", "hola"]])))).toBe("skip");
  });

  test("sin señales claras: lo decide Dayana", () => {
    const c = classifyExportRules(chat([["Sofía", "Hola, ¿cómo vas?"], ["Dayana", "Muy bien, gracias. ¿Y tú?"]]));
    expect(c.verdict).toBe("unknown");
    expect(decideExport(c)).toBe("review");
  });
});

describe("detectBatchOwner", () => {
  test("Dayana está en casi todos los chats de la tanda", () => {
    expect(
      detectBatchOwner([
        ["Laura", "Dayana Beltrán"],
        ["Dayana Beltrán", "Ana"],
        ["+57 300 111 2233", "Dayana Beltrán"],
        ["Pedro"],
      ])
    ).toBe("Dayana Beltrán");
  });

  test("con pocos chats o sin alguien común, no adivina", () => {
    expect(detectBatchOwner([["Laura", "Dayana"], ["Dayana", "Ana"]])).toBeNull();
    expect(detectBatchOwner([["A", "B"], ["C", "D"], ["E", "F"]])).toBeNull();
  });
});
