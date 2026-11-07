import { describe, expect, test } from "bun:test";
import { chatInstructionsLine } from "./chat-instructions";

describe("chatInstructionsLine", () => {
  test("empty means no line", () => {
    expect(chatInstructionsLine(null)).toBeNull();
    expect(chatInstructionsLine("   ")).toBeNull();
  });
  test("labels the instruction and keeps payments above it", () => {
    const line = chatInstructionsLine("No le ofrezcas la llamada, ofrécele el taller.");
    expect(line).toContain("SOLO PARA ESTE CHAT");
    expect(line).toContain("nunca por encima de las de pagos");
    expect(line).toContain("ofrécele el taller");
  });
});
