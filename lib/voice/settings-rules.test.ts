import { describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_VOICE, normalizePhone, overLimit, parseAgentVoiceSettings, withinOwnerHours } from "./settings-rules";

describe("parseAgentVoiceSettings", () => {
  test("missing or broken row → everything off", () => {
    expect(parseAgentVoiceSettings(null)).toEqual(DEFAULT_AGENT_VOICE);
    expect(parseAgentVoiceSettings("{nope")).toEqual(DEFAULT_AGENT_VOICE);
    expect(parseAgentVoiceSettings("[1,2]")).toEqual(DEFAULT_AGENT_VOICE);
  });

  test("calls default to off; unknown provider → off", () => {
    expect(parseAgentVoiceSettings(JSON.stringify({ calls: "twilio" })).calls).toBe("twilio");
    expect(parseAgentVoiceSettings(JSON.stringify({ calls: "skype" })).calls).toBe("off");
  });

  test("one bad field falls back alone", () => {
    const s = parseAgentVoiceSettings(JSON.stringify({ voiceNotes: true, ownerPhone: "abc", quietStartHour: 30 }));
    expect(s.voiceNotes).toBe(true);
    expect(s.ownerPhone).toBeNull();
    expect(s.quietStartHour).toBe(8);
  });

  test("an inverted window resets to the default window", () => {
    const s = parseAgentVoiceSettings(JSON.stringify({ quietStartHour: 22, quietEndHour: 7 }));
    expect([s.quietStartHour, s.quietEndHour]).toEqual([8, 21]);
  });
});

describe("normalizePhone", () => {
  test.each([
    ["+57 300 123 4567", "+573001234567"],
    ["573001234567", "+573001234567"],
    ["(+1) 415-555-0100", "+14155550100"],
    ["300", null],
    ["", null],
    [null, null],
  ])("%p → %p", (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });
});

describe("withinOwnerHours (Bogotá, UTC−5)", () => {
  const s = { quietStartHour: 8, quietEndHour: 21 };
  test("7:59 Bogotá is too early, 8:00 is fine, 20:59 fine, 21:00 too late", () => {
    expect(withinOwnerHours(s, new Date("2026-11-09T12:59:00Z"))).toBe(false);
    expect(withinOwnerHours(s, new Date("2026-11-09T13:00:00Z"))).toBe(true);
    expect(withinOwnerHours(s, new Date("2026-11-10T01:59:00Z"))).toBe(true);
    expect(withinOwnerHours(s, new Date("2026-11-10T02:00:00Z"))).toBe(false);
  });
});

describe("overLimit", () => {
  test("day cap wins over hour cap", () => {
    expect(overLimit("voiceNote", { lastHour: 0, lastDay: 20 })).toBe("day");
    expect(overLimit("voiceNote", { lastHour: 6, lastDay: 6 })).toBe("hour");
    expect(overLimit("voiceNote", { lastHour: 5, lastDay: 19 })).toBeNull();
    expect(overLimit("call", { lastHour: 2, lastDay: 2 })).toBe("hour");
  });
});
