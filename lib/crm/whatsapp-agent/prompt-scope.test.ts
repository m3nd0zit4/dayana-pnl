import { describe, expect, test } from "bun:test";

import { defaultWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";

import { AFTER_CALL_RULES, promptScope } from "./prompt-scope";
import { BOOKED_RULES, salesFlowRules } from "./sales-flow";

describe("reglas según la etapa (fase 6)", () => {
  test("apagado: siempre como antes", () => {
    for (const stage of ["nueva", "llamada_agendada", "tuvo_llamada"] as const) {
      expect(promptScope({ enabled: false, stage })).toBe("full");
    }
  });

  test("cada etapa a su alcance", () => {
    expect(promptScope({ enabled: true, stage: "nueva" })).toBe("lead");
    expect(promptScope({ enabled: true, stage: "conversando" })).toBe("lead");
    expect(promptScope({ enabled: true, stage: "no_contesto" })).toBe("lead");
    expect(promptScope({ enabled: true, stage: "llamada_agendada" })).toBe("booked");
    expect(promptScope({ enabled: true, stage: "tuvo_llamada" })).toBe("after_call");
    expect(promptScope({ enabled: true, stage: "clienta_pasada" })).toBe("full");
    expect(promptScope({ enabled: true, stage: "por_revisar" })).toBe("full");
    expect(promptScope({ enabled: true, stage: null })).toBe("full");
  });

  test("una llamada recién agendada cuenta aunque la etapa diga «conversando»", () => {
    expect(promptScope({ enabled: true, stage: "conversando", upcomingCall: true })).toBe("booked");
  });

  test("clienta, inscrita a un evento o hablando del taller: su propio camino", () => {
    expect(promptScope({ enabled: true, stage: "nueva", clientMode: true })).toBe("full");
    expect(promptScope({ enabled: true, stage: "nueva", guest: true })).toBe("full");
    expect(promptScope({ enabled: true, stage: "tuvo_llamada", workshopFlow: true })).toBe("full");
  });

  test("con la llamada agendada: sin el embudo ni las preguntas clave", () => {
    const config = defaultWhatsAppAiConfig();
    const booked = salesFlowRules(config, { autoBook: true, scope: "booked" });
    const lead = salesFlowRules(config, { autoBook: true });
    expect(booked).toContain(BOOKED_RULES);
    expect(booked).not.toContain("PREGUNTAS CLAVE");
    expect(booked).not.toContain("PERSONA NUEVA");
    expect(booked).toContain("ASISTENTE PERSONAL");
    expect(booked.length).toBeLessThan(lead.length);
    // El flujo de siempre no cambia.
    expect(lead).toContain("PREGUNTAS CLAVE");
    expect(lead).not.toContain(BOOKED_RULES);
  });

  test("tras la llamada: nada de persona nueva ni de invitar a la llamada", () => {
    expect(AFTER_CALL_RULES).not.toContain("PERSONA NUEVA");
    expect(AFTER_CALL_RULES).toContain("register_payment_receipt");
    expect(AFTER_CALL_RULES).not.toMatch(/request_booking|offer_free_call_slots/);
  });
});
