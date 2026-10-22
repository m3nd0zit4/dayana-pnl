import { describe, expect, test } from "bun:test";

import type { ChatPaymentLink } from "./chat-payment-link";
import { asksForMoreHelp, PAY_MARKER, seriousReply, SUPPORT_FIRST } from "./serious-reply";

const link: ChatPaymentLink = { url: "https://www.dayanabeltran.com/pagar/p/therapy-3", sentAt: null, label: "paquete de 3 sesiones" };
const base = { risk: false, modelUrgent: false, stage: "tuvo_llamada", link, hasPaymentData: false, priorAi: [] as string[], canOfferFreeCall: false, upcomingLabel: null };

describe("seriousReply: nunca deja de responder (dueño, 21-oct)", () => {
  test("riesgo de verdad: apoyo, sin pago y sin decir que Dayana se enteró", () => {
    const first = seriousReply({ ...base, risk: true });
    expect(first.text).toBe(SUPPORT_FIRST);
    expect(first.attachLink).toBe(false);
    expect(first.text).not.toMatch(/dayana|pago/i);
    const second = seriousReply({ ...base, risk: true, priorAi: [SUPPORT_FIRST] });
    expect(second.text).not.toBe(SUPPORT_FIRST);
    expect(second.text).toMatch(/emergencias/);
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

  test("el modelo dijo urgente sin señales de riesgo: el paso del pago y una línea de seguridad", () => {
    const r = seriousReply({ ...base, modelUrgent: true });
    expect(r.text).toContain(PAY_MARKER);
    expect(r.text).toMatch(/línea de emergencias de tu país\.$/);
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
