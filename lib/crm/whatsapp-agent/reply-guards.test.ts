import { describe, expect, test } from "bun:test";

import { answeringDayana, closingNotNeeded, isClosingLine, promisesHandoff, withoutToolText, writesAccountNumber } from "./reply-guards";

const ai = (body: string, extra = {}) => ({ direction: "OUTBOUND", body, isAutoReply: true, kind: "message", status: "DELIVERED", ...extra });
const dayana = (body: string) => ({ direction: "OUTBOUND", body, isAutoReply: false, kind: "message", status: "DELIVERED" });
const inb = (body: string) => ({ direction: "INBOUND", body });

describe("isClosingLine", () => {
  test("cierres", () => {
    expect(isClosingLine("Con gusto, Alexandra. Te bendigo 🙏")).toBe(true);
    expect(isClosingLine("Te bendigo, Carmen 🙏")).toBe(true);
    expect(isClosingLine("Con gusto 🙏")).toBe(true);
  });
  test("una respuesta de verdad no es un cierre", () => {
    expect(isClosingLine("Con gusto, Carmen. Cuando realices tu pago, me compartes el comprobante por aquí para que Dayana lo revise.")).toBe(false);
    expect(isClosingLine("Con gusto. ¿Desde qué país me escribes?")).toBe(false);
  });
});

describe("closingNotNeeded (a un «gracias», «amén», emoji)", () => {
  test("Carmen: lo último nuestro ya fue un cierre", () => {
    expect(closingNotNeeded([inb("Igualmente"), ai("Te bendigo, Carmen 🙏"), inb("Vale mil gracias🙏💕")])).toBe(true);
  });
  test("Patricia: lo último lo escribió Dayana", () => {
    expect(closingNotNeeded([inb("Gracias Dayana"), dayana("🎤 Hola, mi hermosa, te bendigo. Bueno, tenemos este evento…")])).toBe(true);
  });
  test("un recordatorio no cuenta: se mira lo de antes", () => {
    expect(closingNotNeeded([inb("Gracias"), ai("Hola Ana 🙏 Te recuerdo…", { source: "recordatorio:1h:x" }), ai("Con gusto 🙏")])).toBe(true);
  });
  test("después de una respuesta de la IA sí va un cierre", () => {
    expect(closingNotNeeded([inb("Gracias"), ai("Tu llamada queda agendada para el jueves a las 3:00 p. m. Dayana te llama por WhatsApp.")])).toBe(false);
  });
});

describe("answeringDayana", () => {
  test("lo último antes de la persona es de Dayana", () => {
    expect(answeringDayana([ai("Hola"), dayana("Hola Alexandra, te habla Dayana Beltrán"), inb("Hola doc"), inb("Estoy en cita de medicina general")])).toBe(true);
  });
  test("de la IA o sin nada antes: no", () => {
    expect(answeringDayana([dayana("Hola"), ai("¿Desde qué país me escribes?"), inb("Perú")])).toBe(false);
    expect(answeringDayana([inb("Hola")])).toBe(false);
  });
});

describe("withoutToolText", () => {
  test("Ruben: la herramienta escrita como texto no sale", () => {
    expect(withoutToolText('Save_country(city="New York", countryIso="US", timezone="America/New_York")')).toEqual({ text: "", had: true });
    expect(withoutToolText('Perfecto, Ruben.\nsave_country(city="New York")')).toEqual({ text: "Perfecto, Ruben.", had: true });
  });
  test("un texto normal queda igual", () => {
    expect(withoutToolText("Claro (hora de Colombia), te llamo_ luego")).toEqual({ text: "Claro (hora de Colombia), te llamo_ luego", had: false });
  });
});

describe("promisesHandoff", () => {
  test("promete que Dayana se entera", () => {
    expect(promisesHandoff("Le paso tu mensaje a Dayana para que lo revise y se ponga en contacto contigo.")).toBe(true);
    expect(promisesHandoff("Déjame consultarlo con Dayana y te confirmo por aquí.")).toBe(true);
    expect(promisesHandoff("Ya le aviso a Dayana.")).toBe(true);
  });
  test("lo demás no", () => {
    expect(promisesHandoff("Dayana te llama por WhatsApp a este número.")).toBe(false);
    expect(promisesHandoff("Con gusto 🙏")).toBe(false);
  });
});

describe("writesAccountNumber", () => {
  test("una cuenta escrita a mano (inventada en la evaluación del 21-oct)", () => {
    expect(writesAccountNumber("*Número de cuenta:* 123-456789-00")).toBe(true);
    expect(writesAccountNumber("Cuenta 15460415745")).toBe(true);
  });
  test("horas, fechas cortas y valores no", () => {
    expect(writesAccountNumber("el jueves 22 de octubre a las 12:30 p. m.")).toBe(false);
    expect(writesAccountNumber("Claro, te comparto los datos para el pago.")).toBe(false);
  });
});
