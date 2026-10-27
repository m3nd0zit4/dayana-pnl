import { describe, expect, test } from "bun:test";

import { defaultWhatsAppAiConfig } from "../whatsapp-ai-config";
import { acceptedCallWithoutHours, availabilityArgs, flowState, flowStateText, nextStep, salesFlowRules, type FlowLine } from "./sales-flow";

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

describe("acceptedCallWithoutHours (Moi, Belén, Ana, 21–26 oct: dijeron que sí y nunca les llegaron horas)", () => {
  const INVITE = "Si quieres, te agendo una llamada gratis de 15 minutos con Dayana, sin costo ni compromiso. Ella te escucha y te dice cómo te puede ayudar.";

  test("Moi: «Exelente» + «Gracias» a la invitación", () => {
    expect(acceptedCallWithoutHours([out("¿Cuánto tiempo más quieres seguir así?"), inb("Ya no lo quiero"), out(INVITE), inb("Exelente"), inb("Gracias")])).toBe(true);
  });

  test("Belén: «Si, pero si podria ser privada, no en un live»", () => {
    expect(acceptedCallWithoutHours([out(`${INVITE} ¿Qué te parece?`), inb("Si, pero si podria ser privada, no en un live")])).toBe(true);
  });

  test("Ana: «si porfavor» y la asistente le pregunta el país y la ciudad", () => {
    const lines = [
      out("Para darte toda la información, si gustas agendamos una llamada gratis de 15 minutos con Dayana sin costo ni compromiso. ¿Desde qué país nos escribes?"),
      inb("si porfavor"),
      out("Qué alegría. Cuéntame, ¿desde qué país y ciudad nos escribes para agendar tu llamada?"),
      inb("soy colombiana mi nombre es Ana botello"),
    ];
    expect(acceptedCallWithoutHours(lines)).toBe(true);
    expect(
      acceptedCallWithoutHours([...lines, out("Gracias, Ana. ¿En qué ciudad de México te encuentras para agendar tu llamada gratis con Dayana?"), inb("cuidad de México")])
    ).toBe(true);
  });

  test("ya le llegaron horas o ya quedó agendada: no", () => {
    const offer = "Con gusto, estas son las horas libres de Dayana:\n\n1. jueves 29 de octubre, 3:00 p. m. (tu hora)\n2. viernes 30, 9:00 a. m.\n\n¿Cuál de estas te queda mejor?";
    expect(acceptedCallWithoutHours([out(INVITE), inb("Sí"), out(offer), inb("Gracias")])).toBe(false);
    expect(acceptedCallWithoutHours([out(INVITE), inb("Sí"), out("Listo. Tu llamada gratis con Dayana quedó para el jueves 29 de octubre, 3:00 p. m."), inb("Gracias")])).toBe(false);
  });

  test("dijo que no, o todavía no contestó la invitación: no", () => {
    expect(acceptedCallWithoutHours([out(INVITE), inb("No por ahora, gracias")])).toBe(false);
    expect(acceptedCallWithoutHours([out(INVITE), inb("Sí"), out("¿Desde qué país me escribes?"), inb("Mejor más adelante")])).toBe(false);
    expect(acceptedCallWithoutHours([out(INVITE), inb("¿Y eso cuánto cuesta?")])).toBe(false);
  });

  test("la conversación siguió en otra cosa (lo último nuestro no es del camino a las horas): no", () => {
    expect(
      acceptedCallWithoutHours([out(INVITE), inb("Sí"), out("Claro, el taller es el 15 de noviembre y lo da Dayana en vivo."), inb("Gracias")])
    ).toBe(false);
  });

  test("sin invitación: no", () => {
    expect(acceptedCallWithoutHours([out("Hola, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"), inb("Sí, bien")])).toBe(false);
  });
});

describe("Adrienne (26-oct): dijo cuándo puede y cada mensaje terminaba en «Déjame consultarlo con Dayana»", () => {
  const lines: FlowLine[] = [
    out("Cada proceso se adapta a lo que necesitas, y Dayana te explica las opciones y los valores en una llamada gratis de 15 minutos.\n\nSi quieres, te agendo la llamada con ella sin costo ni compromiso para que te oriente."),
    inb("Sanar relacion con Padre ...con madre ... y con niña interior.\n\nInicialmente."),
    out("Sanar la relación con papá, mamá y la niña interior es un paso muy valioso. Si quieres que Dayana te oriente, dime qué días puedes y en qué horario (mañana o tarde) para agendarte la llamada gratis de 15 minutos."),
    inb("Horario de Argentina solo de noche a las 20:00:hs .... no se que hora es esta en Colombia."),
  ];

  test("decir cuándo puede a «¿qué días puedes?» es aceptar", () => {
    expect(acceptedCallWithoutHours(lines)).toBe(true);
  });

  test("el aviso «Déjame consultarlo con Dayana» no corta el camino", () => {
    const after = [...lines, out("Déjame consultarlo con Dayana y te confirmo por aquí."), inb("Todos los dias a esa hora puedo."), inb("Para llamada de 15 min.")];
    expect(acceptedCallWithoutHours(after)).toBe(true);
  });

  test("sin invitación antes, decir un horario no es aceptar nada", () => {
    expect(acceptedCallWithoutHours([out("Hola, te bendigo. ¿Cómo estás?"), inb("Bien, trabajo de noche")])).toBe(false);
  });
});

describe("availabilityArgs", () => {
  test("Adrienne: de noche a las 20:00, todos los días; lo de las sesiones no cuenta", () => {
    expect(
      availabilityArgs([
        "Horario de Argentina solo de noche a las 20:00:hs .... no se que hora es esta en Colombia.",
        "Todos los dias a esa hora puedo.",
        "Para llamada de 15 min.",
        "Luego para sesion puedo todos los sabados en transcurso de la mañana desde 09:00.a.m.hs hasta 12:00.a.m.hs",
      ])
    ).toEqual({ franja: "noche" });
  });

  test("fines de semana, entre semana, días con plural, y la hora da la franja", () => {
    expect(availabilityArgs(["Prefiero los fines de semana en la tarde"])).toEqual({ dias: ["sabado", "domingo"], franja: "tarde" });
    expect(availabilityArgs(["Entre semana después del trabajo, a las 7 pm"])).toEqual({ dias: ["lunes", "martes", "miercoles", "jueves", "viernes"], franja: "noche" });
    expect(availabilityArgs(["Los sábados en la mañana"])).toEqual({ dias: ["sabado"], franja: "mañana" });
    expect(availabilityArgs(["Martes o jueves a las 10"])).toEqual({ dias: ["martes", "jueves"], franja: "mañana" });
  });

  test("lo que no puede no se toma como lo que puede; nada dicho = nada", () => {
    expect(availabilityArgs(["El lunes no puedo"])).toEqual({});
    expect(availabilityArgs(["Sí, me interesa"])).toEqual({});
  });
});
