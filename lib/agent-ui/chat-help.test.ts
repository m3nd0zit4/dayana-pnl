import { describe, expect, test } from "bun:test";
import { chatHelpOpener, unansweredText } from "./chat-help";

const msg = (direction: "INBOUND" | "OUTBOUND", body: string, kind = "message") => ({ direction, body, kind });

describe("pregúntale al asistente desde un chat", () => {
  test("cita lo que la persona escribió desde la última respuesta", () => {
    const messages = [
      msg("INBOUND", "Hola"),
      msg("OUTBOUND", "Hola Laura, te bendigo"),
      msg("INBOUND", "¿Puedo cambiar mi llamada?"),
      msg("INBOUND", "El jueves no puedo"),
    ];
    expect(unansweredText(messages)).toBe("¿Puedo cambiar mi llamada? / El jueves no puedo");
  });

  test("sin nada nuevo, cita su último mensaje", () => {
    expect(unansweredText([msg("INBOUND", "Gracias"), msg("OUTBOUND", "Con gusto")])).toBe("Gracias");
  });

  test("los avisos del sistema no cortan", () => {
    expect(unansweredText([msg("OUTBOUND", "Hola"), msg("INBOUND", "¿Y el precio?"), msg("OUTBOUND", "La IA escaló", "system")])).toBe(
      "¿Y el precio?"
    );
  });

  test("el mensaje dice quién, qué pidió, por qué y qué hace el asistente", () => {
    const { title, message } = chatHelpOpener({
      name: "Laura Gómez",
      phone: "573001234567",
      reason: "Cambio de cita",
      detail: "hace 5 min",
      messages: [msg("INBOUND", "¿Puedo pasar mi llamada al viernes?")],
    });
    expect(title).toBe("¿Qué le contesto a Laura Gómez?");
    expect(message).toContain("Laura Gómez (+573001234567) escribió: «¿Puedo pasar mi llamada al viernes?».");
    expect(message).toContain("(Cambio de cita · hace 5 min)");
    expect(message).toContain("lo apruebes");
  });

  test("si el nombre ya es el número no lo repite", () => {
    const { message } = chatHelpOpener({ name: "+573001234567", phone: "573001234567", reason: null, messages: [] });
    expect(message.startsWith("El chat de +573001234567 te espera.")).toBe(true);
  });
});
