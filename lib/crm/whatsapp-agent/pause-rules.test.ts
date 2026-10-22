import { describe, expect, test } from "bun:test";

import { MANUAL_PAUSE_REASON } from "../whatsapp-attention-rules";
import { escalationPauses, isCrisis, pauseHolds } from "./pause-rules";

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
    // Dayana contestó una crisis (pasó a pausa humana): sigue apartada hasta soltarla a mano.
    expect(pauseHolds(pause("human", "clinical", "urgent", "Crisis"), off)).toBe(true);
  });

  test("con los interruptores encendidos, todo pausa como antes", () => {
    expect(pauseHolds(pause("human"), on)).toBe(true);
    expect(pauseHolds(pause("escalation", "payment", "normal", "x"), on)).toBe(true);
  });
});

describe("isCrisis: solo un riesgo de verdad (Joselyn, 21-oct)", () => {
  test("Joselyn: angustia por su hermana enferma y pide una sesión gratis → no es crisis: la IA contesta", () => {
    const joselyn = "Joselyn pide que le quite la angustia por su hermana enferma y pregunta por una sesión gratis.";
    expect(isCrisis({ category: "clinical", severity: "normal", reason: joselyn })).toBe(false);
    expect(pauseHolds(pause("escalation", "clinical", "normal", joselyn), off)).toBe(false);
    expect(escalationPauses({ category: "clinical", severity: "normal", reason: joselyn }, off)).toBe(false);
  });
  test("tristeza, ansiedad, duelo, insomnio: no", () => {
    for (const reason of ["Cuenta que tiene ansiedad e insomnio desde hace meses.", "Está en duelo por la muerte de su mamá.", "Se siente sola y triste."]) {
      expect([reason, isCrisis({ category: "clinical", severity: "normal", reason })]).toEqual([reason, false]);
    }
  });
  test("hacerse daño, no querer vivir, violencia, abuso, «crisis»: sí, aunque el modelo diga normal", () => {
    for (const reason of [
      "Dice que no quiere vivir más.",
      "Habla de quitarse la vida.",
      "Menciona que se quiere hacer daño.",
      "La madre relata episodios de violencia, resistencia del hijo a recibir ayuda psicológica y tensión familiar.",
      "Cuenta que sufre maltrato de su pareja.",
      "Crisis",
    ]) {
      expect([reason, isCrisis({ category: "clinical", severity: "normal", reason })]).toEqual([reason, true]);
    }
  });
  test("urgente siempre; clínico sin motivo (no se sabe): sí", () => {
    expect(isCrisis({ category: "payment", severity: "urgent", reason: "Cobro doble" })).toBe(true);
    expect(isCrisis({ category: "clinical", severity: "normal", reason: null })).toBe(true);
    expect(isCrisis({ category: "payment", severity: "normal", reason: "violencia" })).toBe(false);
  });
});

describe("escalationPauses", () => {
  test("solo lo delicado calla a la IA con el interruptor apagado", () => {
    expect(escalationPauses({ category: "payment", severity: "normal", reason: "x" }, off)).toBe(false);
    expect(escalationPauses({ category: "clinical", severity: "urgent", reason: "x" }, off)).toBe(true);
    expect(escalationPauses({ category: "unknown", severity: "normal", reason: "x" }, on)).toBe(true);
  });
});
