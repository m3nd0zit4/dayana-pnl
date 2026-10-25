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

  test("Naty (18-oct): «Ya no quiero sentirme así» habla de lo que le pasa, no dice que no", () => {
    const invited = [out("Hola"), out("¿Desde qué país me escribes?"), out("Si quieres, te agendo una llamada gratis de 15 minutos con Dayana")];
    for (const s of ["Ya no quiero sentirme así", "no quiero seguir así", "No puedo seguir con esto", "no puedo dormir"]) {
      expect(flowState([...invited, inb(s)]).declined).toBe(false);
    }
    for (const s of ["no quiero, gracias", "No me interesa", "no puedo ahora, después te escribo"]) {
      expect(flowState([...invited, inb(s)]).declined).toBe(true);
    }
  });

  test("un «sí» después del no lo deshace", () => {
    const declined = [out("Hola"), out("¿Desde qué país me escribes?"), out("¿Te agendo la llamada gratis de 15 minutos?"), inb("Ahorita no")];
    expect(flowState([...declined, inb("Si")]).declined).toBe(false);
    expect(flowState([...declined, inb("S,i deseo la llamada")]).declined).toBe(false);
    expect(flowState([...declined, inb("gracias")]).declined).toBe(true);
  });

  test("isInvite (la llamada del taller): invita desde ese mensaje y deja atrás un «no» de antes (revisión 24-oct)", () => {
    const offer = out("El taller está abierto. La inscripción es con una llamada con Dayana. ¿Quieres que te la separe?");
    const isInvite = (l: FlowLine) => l === offer;
    const lines = [out("Hola"), out("¿Desde qué país me escribes?"), out("¿Te agendo la llamada gratis de 15 minutos?"), inb("más adelante"), offer, inb("Me interesa")];
    const s = flowState(lines, { isInvite });
    expect(s.invited).toBe(true);
    expect(s.declined).toBe(false);
    expect(nextStep(s)).toContain("offer_free_call_slots");
    // Un «más adelante» de antes de cualquier invitación no cuenta como «no».
    expect(flowState([inb("más adelante te escribo para pagar"), offer, inb("Me interesa")], { isInvite }).declined).toBe(false);
    // Sin la oferta del taller, nada cambia.
    expect(flowState([out("Hola"), inb("Me interesa")], { isInvite }).invited).toBe(false);
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
