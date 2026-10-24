import { describe, expect, test } from "bun:test";

import type { ChatPaymentLink } from "./chat-payment-link";
import { asksForMoreHelp, PAY_MARKER, seriousReply } from "./serious-reply";

const link: ChatPaymentLink = { url: "https://www.dayanabeltran.com/pagar/p/therapy-3", sentAt: null, label: "paquete de 3 sesiones" };
const base = { risk: false, stage: "tuvo_llamada", link, hasPaymentData: false, priorAi: [] as string[], canOfferFreeCall: false, upcomingLabel: null };

describe("seriousReply: nunca deja de responder (dueño, 21-oct)", () => {
  test("lo que cuenta de su vida, por duro que sea: una frase de apoyo y la llamada gratis, sin emergencias ni «le aviso a Dayana» (dueña, 24-oct)", () => {
    const r = seriousReply({ ...base, stage: "conversando", canOfferFreeCall: true });
    expect(r.text).toMatch(/^Te entiendo\./);
    expect(r.text).toMatch(/llamada gratis de 15 minutos/);
    expect(r.text).not.toMatch(/emergencia|urgencias|peligro|le aviso|le paso/i);
    expect(r.attachLink).toBe(false);
  });

  test("Joselyn: tras la llamada, la escalera del pago: primero, directo, corto", () => {
    const one = seriousReply(base);
    expect(one.text).toContain("Tu llamada gratis con Dayana ya la tuviste");
    expect(one.text).toContain("paquete de 3 sesiones");
    expect(one.attachLink).toBe(true);
    const two = seriousReply({ ...base, priorAi: [one.text] });
    expect(two.text).toMatch(/de forma directa/);
    expect(two.text).toMatch(/muchas personas/);
    expect(two.text).toMatch(/nada va a cambiar/);
    expect(two.text.toLowerCase()).toContain(PAY_MARKER);
    const three = seriousReply({ ...base, priorAi: [one.text, "otra cosa", two.text] });
    expect(three.text).toMatch(/^Como te dije, el siguiente paso es el pago del paquete de 3 sesiones/);
    for (const r of [one, two, three]) expect(r.text).not.toMatch(/le aviso|le paso|consultarlo/i);
  });

  test("Raquel: Dayana le mandó los datos (Western Union), no un enlace: «con los datos que te envió Dayana»", () => {
    const r = seriousReply({ ...base, link: null, hasPaymentData: true });
    expect(r.attachLink).toBe(false);
    expect(r.text).toMatch(/con los datos que te envió Dayana\. Cuando lo hagas, me mandas el comprobante/);
    expect(r.text).not.toMatch(/Prefieres/);
  });
  test("sin enlace de Dayana: le pregunta cómo quiere pagar", () => {
    const r = seriousReply({ ...base, link: null });
    expect(r.attachLink).toBe(false);
    expect(r.text).toMatch(/enlace de pago o los datos para transferencia\?$/);
  });

  test("sin que ella hable de hacerse daño, nunca una línea de emergencias (dueña, 24-oct; Joselyn la recibió con el pago)", () => {
    const r = seriousReply(base);
    expect(r.text).toContain(PAY_MARKER);
    expect(r.text).not.toMatch(/emergencia|peligro|urgencias/i);
    for (const stage of ["llamada_agendada", "conversando", "por_revisar"]) {
      const other = seriousReply({ ...base, stage, canOfferFreeCall: stage === "conversando", upcomingLabel: stage === "llamada_agendada" ? "lunes, 26 de octubre, 9:15 a. m." : null });
      expect(other.text).not.toMatch(/emergencia|peligro|urgencias/i);
    }
  });

  test("antes de la llamada: la invita a la llamada gratis, o le recuerda la que tiene", () => {
    expect(seriousReply({ ...base, stage: "conversando", canOfferFreeCall: true }).text).toMatch(/te agendo una llamada gratis de 15 minutos/);
    expect(seriousReply({ ...base, stage: "llamada_agendada", upcomingLabel: "jueves, 29 de octubre, 3:00 p. m." }).text).toContain(
      "jueves, 29 de octubre, 3:00 p. m."
    );
    const other = seriousReply({ ...base, stage: "por_revisar" });
    expect(other.text).toMatch(/Dayana trabaja/);
    expect(other.attachLink).toBe(false);
  });
});

describe("asksForMoreHelp", () => {
  test("pide otra llamada, una consulta, una sesión, gratis o ayuda", () => {
    for (const t of ["¿Me puede dar una sesión gratis?", "Quítame la angustia", "quiero otra llamada", "necesito ayuda", "¿podemos reagendar?", "Todo los miedos que tengo"]) {
      expect([t, asksForMoreHelp([t])]).toEqual([t, true]);
    }
  });
  test("no: el enlace no abre, factura, presencial", () => {
    for (const t of ["el enlace no me abre", "¿me das factura?", "¿atiende presencial?"]) {
      expect([t, asksForMoreHelp([t])]).toEqual([t, false]);
    }
  });
});
