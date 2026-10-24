import { describe, expect, test } from "bun:test";

import {
  answeringDayana,
  closingNotNeeded,
  findPseudoToolCall,
  givesEmergencyAdvice,
  isClosingLine,
  PSEUDO_HOLDING,
  promisesHandoff,
  pseudoEscalation,
  sharesAccount,
  typedPaymentData,
  urlKeys,
  withoutInventedUrls,
  withoutToolText,
  writesAccountNumber,
} from "./reply-guards";

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

describe("withoutInventedUrls (Ruth, 23-oct)", () => {
  const known = urlKeys("DATOS: inscripción https://www.dayanabeltran.com/eventos-gratuitos", "Enlace para ingresar: https://meet.google.com/mwy-ootz-hge");
  test("un enlace que no leyó en ninguna parte no sale", () => {
    expect(
      withoutInventedUrls("Claro, Ruth. Para unirte a la comunidad de Dayana, puedes ingresar por aquí\n\nHttps://www.dayanabeltran.com/comunidad:", known, ["dayanabeltran.com"])
    ).toEqual({
      text: "Claro, Ruth. Para unirte a la comunidad de Dayana, puedes ingresar por aquí",
      removed: ["Https://www.dayanabeltran.com/comunidad"],
    });
    expect(withoutInventedUrls("Aquí está: https://chat.whatsapp.com/ExemploComunidad. Te bendigo", known).text).toBe("Aquí está. Te bendigo");
  });
  test("los que están en las reglas, los DATOS o el chat sí (con o sin www, http o barra final)", () => {
    const text = "Inscríbete aquí: https://www.dayanabeltran.com/eventos-gratuitos/ y entra por https://meet.google.com/mwy-ootz-hge.";
    expect(withoutInventedUrls(text, known)).toEqual({ text, removed: [] });
    expect(withoutInventedUrls("Mira dayanabeltran.com o www.dayanabeltran.com", known, ["dayanabeltran.com"]).removed).toEqual([]);
  });
  test("en negrita, con «?…» o con «Https» sigue siendo el mismo (revisión 23-oct); sale con https en minúscula", () => {
    expect(withoutInventedUrls("Aquí tienes: *https://www.dayanabeltran.com/eventos-gratuitos*", known).text).toBe(
      "Aquí tienes: *https://www.dayanabeltran.com/eventos-gratuitos*"
    );
    expect(withoutInventedUrls("Entra aquí: https://meet.google.com/mwy-ootz-hge?authuser=0", known).removed).toEqual([]);
    expect(withoutInventedUrls("Es este\n\nHttps://meet.google.com/mwy-ootz-hge", known).text).toBe("Es este\n\nhttps://meet.google.com/mwy-ootz-hge");
  });
  test("uno inventado en negrita o sin https también sale; los dos puntos de otras líneas se quedan", () => {
    expect(withoutInventedUrls("Aquí: *https://x.co/inventado*", known).text).toBe("Aquí");
    expect(withoutInventedUrls("Únete en dayanabeltran.com/comunidad.", known, ["dayanabeltran.com"])).toEqual({
      text: "Únete en.",
      removed: ["dayanabeltran.com/comunidad"],
    });
    expect(withoutInventedUrls("Horarios:\n- lunes\nMira https://x.co/inventado", known).text).toBe("Horarios:\n- lunes\nMira");
    expect(withoutInventedUrls("Mira dayanabeltran.com/comunidad o www.dayanabeltran.com/comunidad.", known, ["dayanabeltran.com"]).text).toBe("Mira.");
  });
  test("la ruta distingue mayúsculas (un token de /pagar/)", () => {
    const pay = urlKeys("https://www.dayanabeltran.com/pagar/AbC123");
    expect(withoutInventedUrls("https://www.dayanabeltran.com/pagar/abc123", pay).removed).toEqual(["https://www.dayanabeltran.com/pagar/abc123"]);
    expect(withoutInventedUrls("HTTPS://WWW.DAYANABELTRAN.COM/pagar/AbC123", pay).removed).toEqual([]);
  });
});

describe("sharesAccount", () => {
  test("los mismos números, aunque con otro formato", () => {
    expect(sharesAccount("Nequi 3105833188", "mi Nequi es 310 583 3188 a nombre de Dayana")).toBe(true);
    expect(sharesAccount("Bancolombia\nN° Cuenta: 00000000001", "Western Union\nNúmero de cuenta: 00000000002")).toBe(false);
    expect(sharesAccount("Bancolombia (sin número)", "Bancolombia 00000000001")).toBe(false);
  });
});

describe("typedPaymentData (ENNY, 23-oct)", () => {
  const bancolombia = "Bancolombia\nNombre: Julian Mendoza\nTipo de cuenta: Ahorros\nN° Cuenta: 15460415745\nDocumento CC: 1029145651";
  test("la cuenta de Ajustes copiada a mano: sale de su texto y va el bloque tal cual", () => {
    const typed =
      "Claro, Enny. Aquí tienes los datos para el pago:\n\nBancolombia\nNombre: Julian Mendoza\nTipo de cuenta: Ahorros\nN° Cuenta: 15460415745\nDocumento CC: 1029145651\n\nCuando lo hagas, me mandas el comprobante por aquí.";
    // Los datos van al final (`withPaymentBlocks`): «…para el pago:» seguido de otra frase queda en punto.
    expect(typedPaymentData(typed, [{ details: bancolombia, exact: true }])).toEqual({
      text: "Claro, Enny. Aquí tienes los datos para el pago.\n\nCuando lo hagas, me mandas el comprobante por aquí.",
      block: bancolombia,
    });
    expect(typedPaymentData("Claro, Enny. Te comparto los datos:\nN° Cuenta: 15460415745", [{ details: bancolombia, exact: true }])).toEqual({
      text: "Claro, Enny. Te comparto los datos",
      block: bancolombia,
    });
  });
  test("los datos que Dayana mandó ella misma: van SUS líneas, nunca las del modelo (revisión 23-oct)", () => {
    const dayana = "Hola bella, mi Nequi es 310 583 3188 a nombre de Dayana Beltrán";
    expect(
      typedPaymentData("Claro, Ana.\nPuedes pagar al Nequi 3105833188 a nombre de Dayana Beltrán", [{ details: dayana, exact: false }])
    ).toEqual({
      text: "Claro, Ana.",
      block: "Nequi es 310 583 3188 a nombre de Dayana Beltrán",
    });
    // Otro banco y otro titular escritos por el modelo: no salen.
    expect(
      typedPaymentData("Claro.\nBanco: Davivienda\nCuenta: 3105833188\nTitular: Julian Mendoza", [{ details: dayana, exact: false }])
    ).toEqual({ text: "Claro.", block: "Nequi es 310 583 3188 a nombre de Dayana Beltrán" });
  });
  test("el titular, la ciudad o el correo que escribió el modelo tampoco quedan encima del bloque de verdad", () => {
    const dayana = "Hola bella, mi Nequi es 310 583 3188 a nombre de Dayana Beltrán";
    expect(
      typedPaymentData("Claro, Ana.\nNequi: 3105833188\nA nombre de: Julian Mendoza\nCiudad: Bogotá", [{ details: dayana, exact: false }])?.text
    ).toBe("Claro, Ana.");
    expect(typedPaymentData("Claro.\nN° Cuenta: 15460415745\nA nombre de Juan Pérez", [{ details: bancolombia, exact: true }])?.text).toBe("Claro.");
  });
  test("frases que no son datos se quedan", () => {
    expect(
      typedPaymentData("Cuenta conmigo para lo que necesites.\nNúmero de sesiones: 3\nN° Cuenta: 15460415745", [{ details: bancolombia, exact: true }])?.text
    ).toBe("Cuenta conmigo para lo que necesites.\nNúmero de sesiones: 3");
  });
  test("un número que no está en ningún dato de verdad: nada (lo para el freno)", () => {
    expect(typedPaymentData("Número de cuenta: 123-456789-00", [{ details: bancolombia, exact: true }])).toBeNull();
    expect(typedPaymentData("Cuenta 15460415745, cédula 99999999", [{ details: bancolombia, exact: true }])).toBeNull();
    expect(typedPaymentData("Claro, te comparto los datos para el pago.", [{ details: bancolombia, exact: true }])).toBeNull();
  });
  test("un valor no es un número de cuenta", () => {
    expect(
      typedPaymentData("El paquete de 12 sesiones queda en 1.860.000.\nN° Cuenta: 15460415745", [{ details: bancolombia, exact: true }])?.text
    ).toBe("El paquete de 12 sesiones queda en 1.860.000.");
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

describe("givesEmergencyAdvice: la asistente nunca da consejos de emergencia (dueña, 24-oct)", () => {
  test("lo que el modelo escribe por su cuenta y no sale", () => {
    for (const t of [
      "Lo que me cuentas es muy importante. Si sientes que puedes hacerte daño o que estás en peligro, busca ayuda ahora mismo: llama a la línea de emergencias de tu país o ve a urgencias.",
      "Te recomiendo comunicarte con una línea de prevención del suicidio.",
      "Por favor llama al 123 si lo necesitas.",
      "Busca ayuda profesional inmediata.",
      "Puedes acudir a los servicios de emergencia de tu ciudad.",
      "Hay líneas de apoyo emocional gratuitas.",
    ]) {
      expect([t, givesEmergencyAdvice(t)]).toEqual([t, true]);
    }
  });
  test("lo de siempre sí sale: la sesión urgente, la llamada, el pago", () => {
    for (const t of [
      "Te entiendo. Si quieres, te agendo una llamada gratis de 15 minutos con Dayana.",
      "Aquí tienes el enlace de la sesión urgente. Tan pronto hagas el pago, Dayana te agenda la sesión para hoy o mañana por Google Meet.",
      "Francy, te entiendo perfectamente. Si las llamadas de afuera se cortan, estate muy atenta a tu teléfono a la hora programada.",
      "Dayana te llama el lunes a las 9:15 a. m.",
      null,
    ]) {
      expect([t, givesEmergencyAdvice(t)]).toEqual([t, false]);
    }
  });
});
