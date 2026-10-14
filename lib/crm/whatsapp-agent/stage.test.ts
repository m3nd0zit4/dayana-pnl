import { describe, expect, test } from "bun:test";

import { resolveSegment } from "./segment";
import { resolveStage, STAGE_HELP, STAGE_LABEL, STAGES } from "./stage";

const stageOf = (input: Parameters<typeof resolveSegment>[0], extra: { activeProcess?: boolean; missedFreeCall?: boolean } = {}) =>
  resolveStage({ verdict: resolveSegment(input), ...extra });

describe("resolveStage", () => {
  test("cada estado tiene nombre y ayuda", () => {
    for (const s of STAGES) {
      expect(STAGE_LABEL[s]).toBeTruthy();
      expect(STAGE_HELP[s]).toBeTruthy();
    }
  });

  test("del primer mensaje a la llamada", () => {
    expect(stageOf({})).toBe("nueva");
    expect(stageOf({ hadConversation: true })).toBe("conversando");
    expect(stageOf({ hadConversation: true, freeCallUpcoming: true })).toBe("llamada_agendada");
  });

  test("después de la llamada gratis", () => {
    expect(stageOf({ hadConversation: true, pastFreeCall: "done" })).toBe("tuvo_llamada");
    expect(stageOf({ hadConversation: true, pastFreeCall: "missed" }, { missedFreeCall: true })).toBe("no_contesto");
    // La ficha (todo el chat, también lo importado) dice que ya habló con Dayana.
    expect(stageOf({ hadConversation: true, history: { dossierHadSession: true } })).toBe("tuvo_llamada");
    // Reagendó: vuelve a «agendada».
    expect(stageOf({ hadConversation: true, pastFreeCall: "missed", freeCallUpcoming: true }, { missedFreeCall: true })).toBe(
      "llamada_agendada"
    );
  });

  test("clienta en proceso, clienta que ya terminó, por revisar", () => {
    expect(stageOf({ crm: { hasPaidEnrollment: true } }, { activeProcess: true })).toBe("clienta_activa");
    expect(stageOf({ crm: { hasApprovedPayment: true } })).toBe("clienta_pasada");
    expect(stageOf({ crm: { hasUnpaidActiveEnrollment: true } })).toBe("por_revisar");
    // Dice que pagó, sin confirmación de Dayana: sigue conversando (la IA la atiende).
    expect(stageOf({ hadConversation: true, history: { personClaims: 1 } })).toBe("conversando");
    // Una clienta que también tuvo la llamada sigue siendo clienta.
    expect(stageOf({ crm: { hasApprovedPayment: true }, pastFreeCall: "done" }, { activeProcess: true })).toBe("clienta_activa");
  });

  test("personal", () => {
    expect(stageOf({ ignoredNumber: true })).toBe("personal");
    expect(stageOf({ isTeam: true })).toBe("personal");
  });
});
