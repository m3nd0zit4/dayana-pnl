import { describe, expect, test } from "bun:test";
import { morningBriefText } from "./agent-messages";

describe("morningBriefText", () => {
  test("nothing waiting, nothing sent", () => {
    expect(morningBriefText([{ label: "x", count: 0, tone: "todo" }])).toBeNull();
  });
  test("urgent first, ends with a question", () => {
    const text = morningBriefText([
      { label: "3 chats de WhatsApp te esperan", count: 3, tone: "todo" },
      { label: "1 pago sin identificar", count: 1, tone: "alert" },
    ])!;
    expect(text.indexOf("pago sin identificar")).toBeLessThan(text.indexOf("chats de WhatsApp"));
    expect(text.trim().endsWith("?")).toBe(true);
  });
});
