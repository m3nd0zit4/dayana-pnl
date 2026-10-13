import { describe, expect, test } from "bun:test";

import { checkReply, outcomeFromChat, rescheduleMessage, type OutcomeMessage } from "./call-outcome-rules";

const start = new Date("2026-10-20T15:00:00Z");
const at = (min: number) => new Date(start.getTime() + min * 60_000);
const inb = (body: string, min = 20): OutcomeMessage => ({ direction: "INBOUND", body, sentAt: at(min) });
const dayana = (body: string, min = 20, extra: Partial<OutcomeMessage> = {}): OutcomeMessage => ({ direction: "OUTBOUND", body, sentAt: at(min), ...extra });

describe("outcomeFromChat", () => {
  test("ella escribe que no la llamaron: no contestada", () => {
    expect(outcomeFromChat([inb("Hola, no me llamaron, sigo esperando")], { startsAt: start })?.outcome).toBe("no_answer");
  });

  test("Dayana escribe que no contestó: no contestada", () => {
    expect(outcomeFromChat([dayana("Hola Lucía, te llamé y no contestas")], { startsAt: start })?.outcome).toBe("no_answer");
  });

  test("Dayana manda los paquetes después de hablar: contestada", () => {
    expect(outcomeFromChat([dayana("Fue un gusto hablar contigo, te comparto los paquetes")], { startsAt: start })?.outcome).toBe("answered");
  });

  test("ella agradece la llamada: contestada", () => {
    expect(outcomeFromChat([inb("Gracias por la llamada, me encantó")], { startsAt: start })?.outcome).toBe("answered");
  });

  test("pagó después: contestada", () => {
    expect(outcomeFromChat([], { startsAt: start, paidAfter: true })?.outcome).toBe("answered");
  });

  test("sin señales o con señales de las dos: no se decide (se pregunta)", () => {
    expect(outcomeFromChat([inb("Ok, gracias")], { startsAt: start })).toBeNull();
    expect(outcomeFromChat([inb("Gracias por la llamada"), dayana("Te llamé y no contestas")], { startsAt: start })).toBeNull();
  });

  test("lo automático (la IA, recordatorios) no cuenta como Dayana", () => {
    expect(outcomeFromChat([dayana("Fue un gusto hablar contigo", 20, { isAutoReply: true })], { startsAt: start })).toBeNull();
    expect(outcomeFromChat([dayana("No logramos comunicarnos", 20, { source: "recordatorio:x" })], { startsAt: start })).toBeNull();
  });

  test("lo de mucho antes de la llamada no cuenta", () => {
    expect(outcomeFromChat([inb("Sigo esperando tu respuesta", -120)], { startsAt: start })).toBeNull();
  });
});

describe("checkReply", () => {
  test("sí", () => {
    expect(checkReply("Sí, gracias!")).toBe("answered");
    expect(checkReply("si pude, me encantó")).toBe("answered");
    expect(checkReply("Claro")).toBe("answered");
  });

  test("no", () => {
    expect(checkReply("No")).toBe("no_answer");
    expect(checkReply("No me llamó")).toBe("no_answer");
    expect(checkReply("todavía no")).toBe("no_answer");
    expect(checkReply("se me pasó, perdón")).toBe("no_answer");
  });

  test("lo que no se entiende queda sin decidir", () => {
    expect(checkReply("¿Cuánto cuesta el paquete?")).toBeNull();
  });
});

describe("rescheduleMessage", () => {
  test("con horas, en viñetas", () => {
    const text = rescheduleMessage("Lucía Pérez", ["jueves 16 de octubre, 3:00 p. m. (tu hora)", "viernes 17 de octubre, 10:00 a. m. (tu hora)"]);
    expect(text).toContain("Hola Lucía 🙏 Dayana te llamó a la hora de tu llamada gratis y no logramos comunicarnos.");
    expect(text).toContain("• jueves 16 de octubre");
    expect(text).toContain("¿Cuál te queda mejor?");
  });

  test("sin horas libres, le pide un día", () => {
    expect(rescheduleMessage(null, [])).toContain("qué día y hora te quedan bien");
  });
});
