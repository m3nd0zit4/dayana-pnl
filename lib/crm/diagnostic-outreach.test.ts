import { describe, expect, test } from "bun:test";

import { isLiveChat } from "./diagnostic-outreach";

describe("isLiveChat", () => {
  const now = Date.parse("2026-10-26T17:40:41Z");
  test("escribió hace 5 min (Claudia, 26-oct): está conversando, no va el primer mensaje", () => {
    expect(isLiveChat(new Date("2026-10-26T17:35:18Z"), now)).toBe(true);
  });
  test("nunca escribió o hace más de 2 h: va el primer mensaje", () => {
    expect(isLiveChat(null, now)).toBe(false);
    expect(isLiveChat(new Date("2026-10-26T15:30:00Z"), now)).toBe(false);
  });
});
