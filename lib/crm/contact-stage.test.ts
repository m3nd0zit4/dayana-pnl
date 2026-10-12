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

describe("contactStage: llamada gratis vs sesión, y conversación previa", () => {
  const start = new Date("2026-10-20T15:00:00Z");
  const end = (min: number) => new Date(start.getTime() + min * 60_000);

  test("0/0 de 15 min: llamada gratis", () => {
    expect(contactStage({ enrollments: [], nextAppointment: { startsAt: start, endsAt: end(15), sessionsLabel: "0/0" } }).key).toBe("llamada_gratis");
  });

  test("0/0 de una hora: sesión pagada sin paquete, no llamada gratis", () => {
    const stage = contactStage({ enrollments: [], nextAppointment: { startsAt: start, endsAt: end(60), sessionsLabel: "0/0" } });
    expect(stage.key).toBe("conversando");
    expect(stage.label).toContain("sesión");
  });

  test("con mensajes en el chat no es «primera vez que escribe»", () => {
    expect(contactStage({ enrollments: [], messages: 12 }).key).toBe("conversando");
  });
});
