import { describe, expect, test } from "bun:test";
import { lastAssistantText, matchSpokenOption, nextVoiceAction, voicePhase, type VoiceInputs } from "./voice-mode";

const base: VoiceInputs = {
  enabled: true,
  busy: false,
  speaking: false,
  listening: false,
  confirming: false,
  paused: false,
  unspokenPendingId: null,
  unspokenReplyId: null,
};

describe("nextVoiceAction", () => {
  test("off → closes the mic if it was open, else nothing", () => {
    expect(nextVoiceAction({ ...base, enabled: false, listening: true })).toEqual({ type: "stop-listening" });
    expect(nextVoiceAction({ ...base, enabled: false })).toEqual({ type: "none" });
  });

  test("idle with nothing to say → listen", () => {
    expect(nextVoiceAction(base)).toEqual({ type: "listen" });
    expect(nextVoiceAction({ ...base, listening: true })).toEqual({ type: "none" });
  });

  test("never listens while speaking, thinking or counting down an approval", () => {
    for (const s of [{ speaking: true }, { busy: true }, { confirming: true }]) {
      expect(nextVoiceAction({ ...base, ...s, listening: true })).toEqual({ type: "stop-listening" });
      expect(nextVoiceAction({ ...base, ...s })).toEqual({ type: "none" });
    }
  });

  test("a new reply is spoken before the approval it asks for", () => {
    const s = { ...base, unspokenReplyId: "m2", unspokenPendingId: "pending-c1" };
    expect(nextVoiceAction(s)).toEqual({ type: "speak-reply", id: "m2" });
    expect(nextVoiceAction({ ...s, unspokenReplyId: null })).toEqual({ type: "speak-pending", id: "pending-c1" });
    // Si el micrófono seguía abierto, primero se cierra.
    expect(nextVoiceAction({ ...s, listening: true })).toEqual({ type: "stop-listening" });
  });

  test("paused stays paused", () => {
    expect(nextVoiceAction({ ...base, paused: true })).toEqual({ type: "none" });
    expect(voicePhase({ ...base, paused: true })).toBe("paused");
  });
});

describe("voicePhase", () => {
  test("labels each state", () => {
    expect(voicePhase({ ...base, enabled: false })).toBe("off");
    expect(voicePhase({ ...base, busy: true })).toBe("thinking");
    expect(voicePhase({ ...base, speaking: true, busy: true })).toBe("speaking");
    expect(voicePhase({ ...base, confirming: true, speaking: true })).toBe("confirming");
    expect(voicePhase({ ...base, listening: true })).toBe("listening");
  });
});

describe("lastAssistantText", () => {
  test("joins the text parts of the last assistant message, skips tools", () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "¿cuánto vendimos?" }] },
      { id: "a1", role: "assistant", parts: [{ type: "dynamic-tool" }, { type: "text", text: "Vendiste 3 pagos." }, { type: "text", text: " " }] },
    ];
    expect(lastAssistantText(messages)).toEqual({ id: "a1", text: "Vendiste 3 pagos." });
  });

  test("last message from the user, or no text → nothing to say", () => {
    expect(lastAssistantText([{ id: "u1", role: "user", parts: [{ type: "text", text: "hola" }] }])).toBeNull();
    expect(lastAssistantText([{ id: "a1", role: "assistant", parts: [{ type: "dynamic-tool" }] }])).toBeNull();
    expect(lastAssistantText([])).toBeNull();
  });
});

describe("matchSpokenOption", () => {
  const options = [
    { id: "a", label: "Esta semana" },
    { id: "b", label: "El próximo mes" },
  ];
  test("by number or ordinal", () => {
    expect(matchSpokenOption("la primera", options)).toBe("a");
    expect(matchSpokenOption("2", options)).toBe("b");
    expect(matchSpokenOption("opción dos", options)).toBe("b");
  });
  test("by label, accents and case ignored", () => {
    expect(matchSpokenOption("el proximo mes", options)).toBe("b");
    expect(matchSpokenOption("pues esta semana", options)).toBe("a");
  });
  test("no match or ambiguous → null", () => {
    expect(matchSpokenOption("mañana", options)).toBeNull();
    expect(matchSpokenOption("", options)).toBeNull();
  });
});
