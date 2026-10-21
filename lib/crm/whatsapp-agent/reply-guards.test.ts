import { describe, expect, test } from "bun:test";

import { answeringDayana, closingNotNeeded, findPseudoToolCall, isClosingLine, PSEUDO_HOLDING, promisesHandoff, pseudoEscalation, withoutToolText, writesAccountNumber } from "./reply-guards";

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

describe("findPseudoToolCall / withoutToolText (Natalia, 21-oct)", () => {
  const natalia =
    "Escalate(category=other,holdingReply=Déjame consultarlo con Dayana y te confirmo por aquí.,reason=La persona dice «No me llamo» (probablemente se cortó la llamada o hubo un problema con la comunicación).,severity=normal)";
  test("la escalada escrita como texto se reconoce, con sus argumentos", () => {
    const call = findPseudoToolCall(natalia);
    expect(call?.name).toBe("escalate");
    expect(call?.args.category).toBe("other");
    expect(call?.args.holdingReply).toBe("Déjame consultarlo con Dayana y te confirmo por aquí.");
    expect(call?.args.reason).toContain("No me llamo");
    expect(call?.args.severity).toBe("normal");
    expect(withoutToolText(natalia)).toEqual({ text: "", had: true });
  });
  test("otras formas: minúsculas, default_api., comillas, entre asteriscos", () => {
    expect(findPseudoToolCall('escalate(category="payment", reason="pide factura")')?.args.category).toBe("payment");
    expect(findPseudoToolCall("default_api.book_free_call(startIso='2026-10-23T14:00:00Z')")?.name).toBe("bookfreecall");
    expect(findPseudoToolCall("**SendPaymentInfo(method=bancolombia)**")?.name).toBe("sendpaymentinfo");
    expect(withoutToolText("Claro, Ana.\nescalate(category=other, reason=x)")).toEqual({ text: "Claro, Ana.", had: true });
  });
  test("las formas conocidas de Gemini: pseudo-XML, tool_code, print(default_api…)", () => {
    const xml = '<default_api.escalate category="other" holdingReply="Déjame consultarlo con Dayana." reason="pide factura" />';
    expect(findPseudoToolCall(xml)?.name).toBe("escalate");
    expect(findPseudoToolCall(xml)?.args.holdingReply).toBe("Déjame consultarlo con Dayana.");
    expect(withoutToolText(xml)).toEqual({ text: "", had: true });
    const code = "```tool_code\nprint(default_api.escalate(category='payment', reason='dice que pagó'))\n```";
    expect(findPseudoToolCall(code)?.name).toBe("escalate");
    expect(findPseudoToolCall(code)?.args.category).toBe("payment");
    expect(withoutToolText(code)).toEqual({ text: "", had: true });
    const multi = 'Claro, Ana.\n<default_api.book_free_call\n  startIso="2026-10-23T14:00:00Z"\n/>';
    expect(findPseudoToolCall(multi)?.name).toBe("bookfreecall");
    expect(withoutToolText(multi).had).toBe(true);
    expect(withoutToolText(multi).text).not.toContain("startIso");
    expect(withoutToolText('<function=escalate>{"category": "other"}</function>')).toEqual({ text: "", had: true });
  });
  test("una frase normal con paréntesis no es una herramienta", () => {
    expect(findPseudoToolCall("Tu llamada queda el viernes (hora de Colombia).")).toBeNull();
    expect(findPseudoToolCall("Con gusto (te bendigo)")).toBeNull();
    expect(withoutToolText("Dayana te llama por WhatsApp (sin enlace).").had).toBe(false);
  });
});

describe("pseudoEscalation", () => {
  test("Natalia: la escalada escrita como texto se hace de verdad, con su espera", () => {
    const natalia =
      "Escalate(category=other,holdingReply=Déjame consultarlo con Dayana y te confirmo por aquí.,reason=La persona dice «No me llamo» (probablemente se cortó la llamada o hubo un problema con la comunicación).,severity=normal)";
    expect(pseudoEscalation(natalia, true)).toEqual({
      category: "other",
      severity: "normal",
      reason: "La persona dice «No me llamo» (probablemente se cortó la llamada o hubo un problema con la comunicación).",
      holdingReply: "Déjame consultarlo con Dayana y te confirmo por aquí.",
    });
  });
  test("categoría desconocida → other; sin espera → la de siempre; urgente se respeta", () => {
    const e = pseudoEscalation("escalate(category=refund, severity=urgent, reason=x)", true);
    expect(e?.category).toBe("other");
    expect(e?.severity).toBe("urgent");
    expect(e?.holdingReply).toBe(PSEUDO_HOLDING);
  });
  test("una escalada aunque quede texto: se escala igual", () => {
    expect(pseudoEscalation("Claro, Ana.\nescalate(category=payment, reason=dice que pagó)", false)?.category).toBe("payment");
  });
  test("otra herramienta: solo si no queda nada que enviar", () => {
    const ruben = 'Save_country(city="New York", countryIso="US")';
    expect(pseudoEscalation(ruben, true)?.reason).toContain("savecountry");
    expect(pseudoEscalation(ruben, true)?.holdingReply).toBe(PSEUDO_HOLDING);
    expect(pseudoEscalation(`Perfecto, Ruben.\n${ruben}`, false)).toBeNull();
  });
  test("un mensaje normal no escala", () => {
    expect(pseudoEscalation("Tu llamada queda el viernes (hora de Colombia).", false)).toBeNull();
    expect(pseudoEscalation("", true)).toBeNull();
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
