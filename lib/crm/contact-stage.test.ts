import { describe, expect, test } from "bun:test";

import { contactStage } from "./contact-stage";

describe("etapa de la persona", () => {
  test("nueva", () => expect(contactStage({ enrollments: [], messages: 1 }).key).toBe("nuevo"));
  test("conversando", () => expect(contactStage({ enrollments: [], messages: 6 }).key).toBe("conversando"));
  test("llamada gratis agendada", () =>
    expect(contactStage({ enrollments: [], nextAppointment: { startsAt: new Date(), sessionsLabel: "0/0" } }).key).toBe("llamada_gratis"));
  test("clienta activa con sesiones", () => {
    const s = contactStage({ enrollments: [{ status: "ACTIVE", sessionsUsed: 2, sessionsTotal: 6, product: "Paquete 6" }] });
    expect(s.key).toBe("clienta_activa");
    expect(s.label).toContain("sesiones 2 de 6");
  });
  test("terminó", () => expect(contactStage({ enrollments: [{ status: "COMPLETED", sessionsUsed: 6, sessionsTotal: 6 }] }).key).toBe("termino"));
});
