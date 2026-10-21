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

  test("Dayana confirmó el pago en el chat: clienta", () => {
    expect(resolveSegment({ history: { dayanaConfirmed: 1 }, hadConversation: true })).toMatchObject({ segment: "client", review: false });
  });

  test("dice que pagó o la ficha lo cree, sin confirmación de Dayana: la IA sigue, por revisar", () => {
    expect(resolveSegment({ history: { personClaims: 1 }, hadConversation: true })).toMatchObject({ segment: "returning_lead", review: true });
    expect(resolveSegment({ history: { dossierPaidSignals: 1 }, hadConversation: true })).toMatchObject({ segment: "returning_lead", review: true });
    // Recibió los datos de pago después de la llamada: sigue en «tuvo la llamada».
    expect(resolveSegment({ history: { personClaims: 1 }, pastFreeCall: "done", hadConversation: true })).toMatchObject({ segment: "after_call", review: true });
    // Haber tenido la llamada (gratis) no la vuelve clienta: «tuvo la llamada».
    expect(resolveSegment({ history: { dossierHadSession: true }, hadConversation: true }).segment).toBe("after_call");
  });

  test("Dayana dijo «no es clienta»: las frases del chat no la vuelven clienta ni la ponen a revisar", () => {
    const v = resolveSegment({ category: "interesada", categorySource: "manual", history: { personClaims: 3, dayanaConfirmed: 1 }, hadConversation: true });
    expect(v).toMatchObject({ segment: "returning_lead", review: false });
  });

  test("la clasificación dice clienta: la IA sigue atendiendo, Dayana lo revisa", () => {
    expect(resolveSegment({ category: "cliente", categorySource: "ai", categoryConfidence: 0.9, hadConversation: true })).toMatchObject({
      segment: "returning_lead",
      review: true,
    });
    // Poco segura: ni revisar.
    expect(resolveSegment({ category: "cliente", categorySource: "ai", categoryConfidence: 0.5, hadConversation: true })).toMatchObject({
      segment: "returning_lead",
      review: false,
    });
    // «No es clienta» a mano manda sobre la clasificación.
    expect(resolveSegment({ category: "interesada", categorySource: "manual", hadConversation: true }).segment).toBe("returning_lead");
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

  test("después de la llamada gratis: tuvo la llamada, o no contestó", () => {
    expect(resolveSegment({ hadConversation: true, pastFreeCall: "done" }).segment).toBe("after_call");
    expect(resolveSegment({ hadConversation: true, pastFreeCall: "missed" }).segment).toBe("returning_lead");
    // Ya reagendó: lo que manda es la llamada que viene.
    expect(resolveSegment({ hadConversation: true, pastFreeCall: "done", freeCallUpcoming: true }).segment).toBe("free_call_booked");
    // Si pagó, es clienta aunque haya tenido la llamada.
    expect(resolveSegment({ crm: { hasApprovedPayment: true }, pastFreeCall: "done" }).segment).toBe("client");
  });

  test("Dayana ya le mandó cómo pagar: tuvo la llamada (Raquel, Carmen, 21-oct)", () => {
    const at = (iso: string) => new Date(iso);
    // Raquel: llamada gratis agendada el 19 a las 5:36; Dayana le mandó Western Union y el valor a las 10:35.
    const raquel = resolveSegment({
      hadConversation: true,
      freeCallUpcoming: true,
      freeCallBookedAt: at("2026-10-19T10:36:00Z"),
      history: { dayanaPaymentInfoAt: at("2026-10-19T15:35:00Z") },
    });
    expect(raquel.segment).toBe("after_call");
    expect(raquel.reason).toContain("Dayana ya le mandó cómo pagar");
    // Sin llamada próxima, o con la llamada que no contestó: igual.
    expect(resolveSegment({ hadConversation: true, history: { dayanaPaymentInfoAt: at("2026-10-19T15:35:00Z") } }).segment).toBe("after_call");
    expect(resolveSegment({ pastFreeCall: "missed", history: { dayanaPaymentInfoAt: at("2026-10-19T15:35:00Z") } }).segment).toBe("after_call");
    // Agendó una llamada nueva DESPUÉS de los datos: manda la llamada.
    expect(
      resolveSegment({
        freeCallUpcoming: true,
        freeCallBookedAt: at("2026-10-20T10:00:00Z"),
        history: { dayanaPaymentInfoAt: at("2026-10-19T15:35:00Z") },
      }).segment
    ).toBe("free_call_booked");
    // Si ya pagó y Dayana lo confirmó, es clienta.
    expect(resolveSegment({ crm: { hasApprovedPayment: true }, history: { dayanaPaymentInfoAt: at("2026-10-19T15:35:00Z") } }).segment).toBe("client");
  });

  test("una clienta con la llamada agendada sigue siendo clienta", () => {
    expect(resolveSegment({ crm: { hasPaidEnrollment: true }, freeCallUpcoming: true }).segment).toBe("client");
    expect(resolveSegment({ freeCallUpcoming: true, hadConversation: true }).segment).toBe("free_call_booked");
  });
});
