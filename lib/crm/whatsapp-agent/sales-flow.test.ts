import { describe, expect, test } from "bun:test";

import { defaultWhatsAppAiConfig } from "../whatsapp-ai-config";
import { flowState, flowStateText, nextStep, salesFlowRules, type FlowLine } from "./sales-flow";

const inb = (body: string): FlowLine => ({ direction: "INBOUND", body });
const out = (body: string): FlowLine => ({ direction: "OUTBOUND", body });

describe("flowState / nextStep", () => {
  test("primer mensaje: saludar", () => {
    expect(nextStep(flowState([inb("Hola, buenas tardes")]))).toContain("saludar");
  });

  test("después del saludo: de dónde escribe", () => {
    const s = flowState([inb("Hola"), out("Hola Ana, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"), inb("Bien, gracias")]);
    expect(s).toMatchObject({ greeted: true, askedFeeling: true, askedCountry: false });
    expect(nextStep(s)).toContain("país");
  });

  test("con el país y la pregunta clave: invitar", () => {
    const s = flowState([
      out("Hola, te bendigo. ¿Cómo estás?"),
      out("¿Desde qué país me escribes?"),
      inb("México, Monterrey. Tengo mucha ansiedad"),
      out("Si quieres recuperar tu esencia y liberar esa ansiedad, puedes agendar..."),
    ], { keyQuestions: defaultWhatsAppAiConfig().salesFlow.buyButtons.map((b) => b.keyQuestion) });
    expect(s.keyQuestion).toBe(true);
    expect(nextStep(s)).toContain("invitar a la persona");
  });

  test("invitada: ofrecer horas; ofrecidas: agendar", () => {
    const invited = [out("Hola, te bendigo"), out("¿Desde qué país me escribes?"), out("¿Cuánto tiempo más quieres seguir así?"), out("Te agendo una llamada gratis de 15 minutos con Dayana")];
    expect(nextStep(flowState(invited))).toContain("offer_free_call_slots");
    expect(nextStep(flowState(invited, { offeredSlots: true }))).toContain("book_free_call");
  });

  test("dijo que no después de la invitación: no insistir", () => {
    const s = flowState([out("Hola"), out("¿Desde qué país me escribes?"), out("¿Te agendo la llamada gratis?"), inb("Ahorita no, después te digo")]);
    expect(s.declined).toBe(true);
    expect(flowStateText(s)).toContain("no insistas");
  });
});

describe("salesFlowRules", () => {
  test("lleva las preguntas clave, el objetivo y nunca nombra los botones", () => {
    const text = salesFlowRules(defaultWhatsAppAiConfig(), { autoBook: true });
    expect(text).toContain("LLAMADA GRATIS de 15 minutos");
    expect(text).toContain("¿Cuánto tiempo más quieres seguir con esa tristeza?");
    expect(text).toContain("nunca digas «botón»");
    expect(text).toContain("Queda agendada al instante");
  });

  test("sin agendar sola: queda para que Dayana confirme", () => {
    expect(salesFlowRules(defaultWhatsAppAiConfig(), { autoBook: false })).toContain("le confirmamos la hora");
  });
});
