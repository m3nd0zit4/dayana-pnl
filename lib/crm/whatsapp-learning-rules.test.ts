import { describe, expect, test } from "bun:test";

import { isHumanReply, isLearnableChat, repeatedReplies } from "./whatsapp-learning-rules";

describe("isHumanReply", () => {
  test("lo que Dayana escribió desde el celular o el CRM", () => {
    expect(isHumanReply({ direction: "OUTBOUND" })).toBe(true);
    expect(isHumanReply({ direction: "OUTBOUND", source: "crm:inbox" })).toBe(true);
  });

  test("ni la IA ni sus borradores aprobados", () => {
    expect(isHumanReply({ direction: "OUTBOUND", isAutoReply: true })).toBe(false);
    expect(isHumanReply({ direction: "OUTBOUND", source: "approval" })).toBe(false);
  });

  test("ni lo que sale solo, ni los avisos grises, ni lo que escribe la persona", () => {
    expect(isHumanReply({ direction: "OUTBOUND", source: "bulk:abc" })).toBe(false);
    expect(isHumanReply({ direction: "OUTBOUND", source: "recordatorio:x" })).toBe(false);
    expect(isHumanReply({ direction: "OUTBOUND", clientKey: "welcome:c1" })).toBe(false);
    expect(isHumanReply({ direction: "OUTBOUND", kind: "system" })).toBe(false);
    expect(isHumanReply({ direction: "INBOUND" })).toBe(false);
  });
});

describe("isLearnableChat", () => {
  test("un chat de trabajo sí", () => {
    expect(isLearnableChat({})).toBe(true);
    expect(isLearnableChat({ category: "cliente", categorySource: "rule", categoryConfidence: 0.95 })).toBe(true);
  });

  test("personal, equipo o empresa no", () => {
    expect(isLearnableChat({ ignoredNumber: true })).toBe(false);
    expect(isLearnableChat({ isTeam: true })).toBe(false);
    expect(isLearnableChat({ segment: "ignored" })).toBe(false);
    expect(isLearnableChat({ category: "personal", categorySource: "manual" })).toBe(false);
    expect(isLearnableChat({ category: "personal", categorySource: "ai", categoryConfidence: 0.95 })).toBe(false);
  });

  test("una etiqueta dudosa no deja de enseñar", () => {
    expect(isLearnableChat({ category: "personal", categorySource: "ai", categoryConfidence: 0.7 })).toBe(true);
    expect(isLearnableChat({ category: "personal", categorySource: "ai", categoryConfidence: 0.95, categoryReview: true })).toBe(true);
  });
});

describe("repeatedReplies", () => {
  const quick = "Hola, gracias por escribir. Las terapias son virtuales y duran una hora, te cuento.";
  test("el mismo texto largo en 5 chats es una plantilla", () => {
    const rows = ["a", "b", "c", "d", "e"].map((conversationId) => ({ conversationId, replyText: quick }));
    expect(repeatedReplies(rows).size).toBe(1);
  });

  test("en 4 chats, o corto, no", () => {
    expect(repeatedReplies(["a", "b", "c", "d"].map((conversationId) => ({ conversationId, replyText: quick }))).size).toBe(0);
    expect(
      repeatedReplies(["a", "b", "c", "d", "e", "f"].map((conversationId) => ({ conversationId, replyText: "Con gusto, te bendigo" }))).size
    ).toBe(0);
  });

  test("varias veces en el mismo chat cuenta una", () => {
    expect(repeatedReplies(Array.from({ length: 6 }, () => ({ conversationId: "a", replyText: quick }))).size).toBe(0);
  });
});
