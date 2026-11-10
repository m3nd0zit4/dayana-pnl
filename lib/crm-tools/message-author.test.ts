import { describe, expect, test } from "bun:test";
import { lastWriter, messageAuthor } from "@/lib/crm-tools/message-author";

describe("messageAuthor", () => {
  test("inbound is the person", () => expect(messageAuthor({ direction: "INBOUND" })).toBe("persona"));
  test("the AI's own reply", () => expect(messageAuthor({ direction: "OUTBOUND", isAutoReply: true })).toBe("IA de WhatsApp"));
  test("Dayana from her phone (echo, no staff, not auto)", () =>
    expect(messageAuthor({ direction: "OUTBOUND", isAutoReply: false })).toBe("Dayana (desde su teléfono)"));
  test("someone from the CRM composer", () =>
    expect(messageAuthor({ direction: "OUTBOUND", staffName: "Dayana Beltrán" })).toBe("Dayana Beltrán (desde el CRM)"));
  test("an approved AI proposal", () =>
    expect(messageAuthor({ direction: "OUTBOUND", source: "approval" })).toBe("IA de WhatsApp (aprobado por Dayana)"));
  test("a bulk send is automatic", () =>
    expect(messageAuthor({ direction: "OUTBOUND", source: "bulk:abc" })).toBe("envío automático"));
});

test("lastWriter", () => {
  expect(lastWriter([{ author: "persona" }, { author: "Dayana (desde su teléfono)" }])).toBe("Dayana (desde su teléfono)");
  expect(lastWriter([])).toBeNull();
});
