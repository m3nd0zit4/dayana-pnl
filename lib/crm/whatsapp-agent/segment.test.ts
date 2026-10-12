import { describe, expect, test } from "bun:test";

import { resolveSegment } from "./segment";

describe("resolveSegment", () => {
  test("primera vez: nueva", () => {
    expect(resolveSegment({}).segment).toBe("new_lead");
  });

  test("ya conversó y no pagó: ya conversó", () => {
    expect(resolveSegment({ hadConversation: true }).segment).toBe("returning_lead");
  });

  test("pagó en el CRM: clienta segura", () => {
    expect(resolveSegment({ crm: { hasApprovedPayment: true }, hadConversation: true })).toMatchObject({ segment: "client", review: false });
  });

  test("inscripción activa sin pago registrado: clienta, por revisar", () => {
    expect(resolveSegment({ crm: { hasUnpaidActiveEnrollment: true }, hadConversation: true })).toMatchObject({ segment: "client", review: true });
  });

  test("pagó por transferencia (frases y ficha coinciden): clienta sin revisar", () => {
    expect(resolveSegment({ history: { strongEvidence: 2, dossierPaidSignals: 1 } })).toMatchObject({ segment: "client", review: false });
  });

  test("ante la duda sobre si pagó: clienta, pero por revisar", () => {
    expect(resolveSegment({ history: { strongEvidence: 1 } })).toMatchObject({ segment: "client", review: true });
    expect(resolveSegment({ history: { dossierPaidSignals: 1 } })).toMatchObject({ segment: "client", review: true });
    expect(resolveSegment({ history: { dossierHadSession: true } })).toMatchObject({ segment: "client", review: true });
  });

  test("Dayana dijo «no es clienta»: las frases del chat no la vuelven clienta", () => {
    const v = resolveSegment({ category: "interesada", categorySource: "manual", history: { strongEvidence: 3 }, hadConversation: true });
    expect(v.segment).toBe("returning_lead");
  });

  test("Dayana la marcó clienta: clienta", () => {
    expect(resolveSegment({ category: "cliente", categorySource: "manual" })).toMatchObject({ segment: "client", source: "manual" });
  });

  test("personal, equipo o número ignorado: no se atiende", () => {
    expect(resolveSegment({ ignoredNumber: true }).segment).toBe("ignored");
    expect(resolveSegment({ isTeam: true }).segment).toBe("ignored");
    expect(resolveSegment({ category: "personal", categorySource: "manual" }).segment).toBe("ignored");
  });

  test("la clasificación solo silencia si está encendida y segura", () => {
    expect(resolveSegment({ classifyEnabled: true, category: "negocio", categoryConfidence: 0.95 }).segment).toBe("ignored");
    expect(resolveSegment({ classifyEnabled: false, category: "negocio", categoryConfidence: 0.95 }).segment).toBe("new_lead");
    expect(resolveSegment({ classifyEnabled: true, category: "personal", categoryConfidence: 0.8 }).segment).toBe("new_lead");
  });

  test("una clienta con la llamada agendada sigue siendo clienta", () => {
    expect(resolveSegment({ crm: { hasPaidEnrollment: true }, freeCallUpcoming: true }).segment).toBe("client");
    expect(resolveSegment({ freeCallUpcoming: true, hadConversation: true }).segment).toBe("free_call_booked");
  });
});
