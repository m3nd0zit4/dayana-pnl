import { describe, expect, test } from "bun:test";
import { spokenApprovalPrompt, spokenDecision, splitForSpeech, toSpeechText } from "./speech-text";

describe("toSpeechText", () => {
  test("strips markdown the synthesizer would read aloud", () => {
    const md = "**Ventas del mes:** 3 pagos.\n\n- Laura: 190.000 COP\n- Ana: 60 USD\n\nVer [el pago](/admin/payments/abc) 🙏";
    expect(toSpeechText(md)).toBe("Ventas del mes: 3 pagos. Laura: 190.000 COP. Ana: 60 USD. Ver el pago.");
  });

  test("URLs, code blocks and tables are not read", () => {
    const md = "Mira https://www.dayanabeltran.com/pagar/p/therapy-1\n\n```json\n{\"a\":1}\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |";
    const out = toSpeechText(md);
    expect(out).toContain("Mira el enlace.");
    expect(out).toContain("te lo dejé en pantalla");
    expect(out).toContain("la tabla te la dejé en pantalla");
    expect(out).not.toContain("http");
    expect(out).not.toContain("|");
  });

  test("long answers are cut at a sentence and say the rest is on screen", () => {
    const md = Array.from({ length: 30 }, (_, i) => `Frase número ${i + 1} con algo de texto.`).join(" ");
    const out = toSpeechText(md, { maxChars: 200 });
    expect(out.length).toBeLessThan(260);
    expect(out.endsWith("El resto te lo dejé en pantalla.")).toBe(true);
    expect(out).toMatch(/texto\. El resto/);
  });

  test("numbered lists and headings become sentences", () => {
    expect(toSpeechText("## Pendientes\n1. Llamar a Rosa\n2) Confirmar pago")).toBe("Pendientes. Llamar a Rosa. Confirmar pago.");
  });
});

describe("splitForSpeech", () => {
  test("joins short sentences up to the limit", () => {
    expect(splitForSpeech("Hola. ¿Cómo estás? Bien.", 200)).toEqual(["Hola. ¿Cómo estás? Bien."]);
  });

  test("never returns a chunk over the limit", () => {
    const long = `${"palabra ".repeat(80)}fin.`;
    const chunks = splitForSpeech(`Inicio. ${long} Otra frase, con coma, y más.`, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join(" ")).toContain("Otra frase");
  });

  test("empty text → no chunks", () => {
    expect(splitForSpeech("")).toEqual([]);
  });
});

describe("spokenDecision", () => {
  test.each([
    ["Sí", "approve"],
    ["sí, hazlo", "approve"],
    ["Dale", "approve"],
    ["sí por favor", "approve"],
    ["claro que sí", null],
    ["No", "deny"],
    ["no, espera", "deny"],
    ["cancela", "deny"],
    ["sí pero cámbiale la hora a las cinco", null],
    ["mándale el mensaje a Laura", null],
    ["", null],
  ])("%p → %p", (text, expected) => {
    expect(spokenDecision(text)).toBe(expected as ReturnType<typeof spokenDecision>);
  });
});

describe("spokenApprovalPrompt", () => {
  test("says what, the key lines and how to answer", () => {
    const out = spokenApprovalPrompt({
      title: "Enviar WhatsApp",
      lines: [
        { label: "Para", value: "Laura Gómez" },
        { label: "Mensaje", value: "**Hola** Laura, te comparto https://x.co/a" },
      ],
    });
    expect(out).toBe(
      "Necesito tu aprobación para: Enviar WhatsApp. Para: Laura Gómez. Mensaje: Hola Laura, te comparto el enlace. ¿Lo hago? Di sí o no, o toca Aprobar."
    );
  });
});
