import { describe, expect, test } from "bun:test";

import { MANUAL_PAUSE_REASON } from "../whatsapp-attention-rules";
import { escalationPauses, pauseHolds } from "./pause-rules";

const off = { onHumanReply: false, onEscalation: false };
const on = { onHumanReply: true, onEscalation: true };
const pause = (reason: string | null, category: string | null = null, severity: string | null = null, why: string | null = null) => ({
  reason,
  escalationCategory: category,
  escalationSeverity: severity,
  escalationReason: why,
});

describe("pauseHolds", () => {
  test("con los interruptores apagados, la IA vuelve a contestar tras una respuesta de Dayana o una escalada", () => {
    expect(pauseHolds(pause("human"), off)).toBe(false);
    expect(pauseHolds(pause(null), off)).toBe(false);
    expect(pauseHolds(pause("escalation", "payment", "normal", "Mandó un comprobante"), off)).toBe(false);
    expect(pauseHolds(pause("escalation", "unknown", "normal", "No sé qué decir"), off)).toBe(false);
  });

  test("lo que pausó Dayana a mano y lo delicado siempre pausan", () => {
    expect(pauseHolds(pause("escalation", "other", "normal", MANUAL_PAUSE_REASON), off)).toBe(true);
    expect(pauseHolds(pause("escalation", null, null, null), off)).toBe(true);
    expect(pauseHolds(pause("escalation", "clinical", "normal", "Crisis"), off)).toBe(true);
    expect(pauseHolds(pause("escalation", "payment", "urgent", "Cobro doble"), off)).toBe(true);
  });

  test("con los interruptores encendidos, todo pausa como antes", () => {
    expect(pauseHolds(pause("human"), on)).toBe(true);
    expect(pauseHolds(pause("escalation", "payment", "normal", "x"), on)).toBe(true);
  });
});

describe("escalationPauses", () => {
  test("solo lo delicado calla a la IA con el interruptor apagado", () => {
    expect(escalationPauses({ category: "payment", severity: "normal" }, off)).toBe(false);
    expect(escalationPauses({ category: "clinical", severity: "urgent" }, off)).toBe(true);
    expect(escalationPauses({ category: "unknown", severity: "normal" }, on)).toBe(true);
  });
});
