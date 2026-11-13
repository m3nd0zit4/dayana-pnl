import { describe, expect, test } from "bun:test";

import { asksForCall, seriousReply } from "./serious-reply";
import { NO_FREE_CALL_STAGES } from "./stage";

const base = { canOfferFreeCall: false, upcomingLabel: null };

describe("seriousReply: nunca deja de responder (dueño, 21-oct)", () => {
  test("lo que cuenta de su vida, por duro que sea: una frase de apoyo y la llamada gratis, sin emergencias ni «le aviso a Dayana» (dueña, 24-oct)", () => {
    const r = seriousReply({ ...base, canOfferFreeCall: true });
    expect(r).toMatch(/^Te entiendo\./);
    expect(r).toMatch(/llamada gratis de 15 minutos/);
    expect(r).not.toMatch(/emergencia|urgencias|peligro|le aviso|le paso/i);
  });

  test("nunca una línea de emergencias (dueña, 24-oct)", () => {
    for (const input of [base, { ...base, canOfferFreeCall: true }, { ...base, upcomingLabel: "lunes, 26 de octubre, 9:15 a. m." }]) {
      expect(seriousReply(input)).not.toMatch(/emergencia|peligro|urgencias/i);
    }
  });

  test("antes de la llamada: la invita a la llamada gratis, o le recuerda la que tiene", () => {
    expect(seriousReply({ ...base, canOfferFreeCall: true })).toMatch(/te agendo una llamada gratis de 15 minutos/);
    expect(seriousReply({ ...base, upcomingLabel: "jueves, 29 de octubre, 3:00 p. m." })).toContain("jueves, 29 de octubre, 3:00 p. m.");
    expect(seriousReply(base)).toMatch(/Dayana trabaja/);
  });

  test("después de su llamada (dueña, 13-nov): solo apoyo, ni otra llamada ni pagos", () => {
    const r = seriousReply(base);
    expect(r).not.toMatch(/llamada|pago|enlace|datos|comprobante/i);
  });
});

describe("ya tuvo su llamada: puede pedir otra o reagendar (dueña, 12-nov)", () => {
  test("«tuvo la llamada» ya no está entre los estados sin llamada gratis; las clientas sí", () => {
    expect(NO_FREE_CALL_STAGES.has("tuvo_llamada")).toBe(false);
    expect(NO_FREE_CALL_STAGES.has("clienta_activa")).toBe(true);
  });
  test("pedir otra llamada o reagendar es pedir la llamada", () => {
    for (const t of ["¿Puedo reagendar la llamada?", "Quiero otra llamada con Dayana", "me puedes agendar otra cita", "quiero hablar con Dayana"]) {
      expect([t, asksForCall([t])]).toEqual([t, true]);
    }
    for (const t of ["Quítame esta angustia", "Necesito acompañamiento", "¿Me das una sesión gratis?", "Gracias por la llamada, ¿y ahora qué?", "Mañana tengo la cita médica"]) {
      expect([t, asksForCall([t])]).toEqual([t, false]);
    }
  });
});
