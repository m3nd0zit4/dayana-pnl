import { describe, expect, test } from "bun:test";
import {
  brandProfile,
  classifyByRules,
  crmVerdict,
  findUrls,
  isCourtesyMessage,
  isSilencingCategory,
  isTeamThread,
  needsReview,
  negocioSignal,
  normalizeTeamPhone,
  parseTeamPhones,
  personMessages,
  signalHints,
  type CategoryMessage,
  type CategorySignals,
  type ChatFacts,
} from "./chat-category-rules";

const inb = (body: string | null, extra: Partial<CategoryMessage> = {}): CategoryMessage => ({
  direction: "INBOUND",
  body,
  kind: "message",
  isEcho: false,
  isAutoReply: false,
  source: null,
  ...extra,
});
const out = (body: string, extra: Partial<CategoryMessage> = {}): CategoryMessage => ({
  direction: "OUTBOUND",
  body,
  kind: "message",
  isEcho: false,
  isAutoReply: false,
  source: null,
  ...extra,
});
const facts = (signals: CategorySignals, messages: CategoryMessage[], extra: Partial<ChatFacts> = {}): ChatFacts => ({
  signals,
  messages,
  ...extra,
});
const cat = (f: ChatFacts) => classifyByRules(f)?.category ?? null;
const only = (...bodies: string[]) => facts({}, bodies.map((b) => inb(b)));

describe("cliente, interesada y equipo (lo que dice el CRM manda)", () => {
  test("pagó un paquete → cliente, aunque escriba un código", () => {
    expect(classifyByRules(facts({ hasPaidEnrollment: true, paidKind: "THERAPY" }, [inb("Tu código es 123456")]))).toEqual({
      category: "cliente",
      confidence: 0.98,
      reason: "Pagó un paquete",
    });
  });

  test("pagó el curso: el motivo lo dice", () => {
    expect(classifyByRules(facts({ hasPaidEnrollment: true, paidKind: "COURSE" }, []))?.reason).toBe("Pagó el curso");
  });

  test("un pago aprobado sin matrícula activa también es cliente", () => {
    expect(classifyByRules(facts({ hasApprovedPayment: true }, [inb("hola")]))?.reason).toBe("Tiene un pago aprobado");
  });

  test("una matrícula activa SIN importe ni pago no es «cliente»: es pista", () => {
    expect(classifyByRules(facts({ hasUnpaidActiveEnrollment: true }, [inb("hola, ¿cómo entro al curso?")]))).toBeNull();
    expect(signalHints({ signals: { hasUnpaidActiveEnrollment: true } })).toContain(
      "Tiene una inscripción activa sin pago registrado."
    );
  });

  test("sesiones de paquete en el calendario (3/8) → cliente", () => {
    expect(cat(facts({ hasTherapySession: true }, []))).toBe("cliente");
  });

  test("número del equipo → equipo, por encima de todo", () => {
    expect(classifyByRules(facts({ isTeamPhone: true, hasPaidEnrollment: true }, [inb("Ya subí el video")]))).toEqual({
      category: "equipo",
      confidence: 1,
      reason: "Número del equipo",
    });
  });

  test("interesada: llamada gratis, autoevaluación, pago a medias, lead", () => {
    expect(classifyByRules(facts({ hasBooking: true }, [inb("listo, gracias")]))?.reason).toBe("Agendó la llamada gratis");
    expect(classifyByRules(facts({ hasDiagnostic: true }, [out("Hola María 💛")]))?.reason).toBe("Hizo la autoevaluación");
    expect(classifyByRules(facts({ hasPendingPayment: true }, []))?.reason).toBe("Empezó a pagar y no terminó");
    expect(cat(facts({ hasLeadEnrollment: true }, [inb("info porfa")]))).toBe("interesada");
  });

  test("la autoevaluación gana a la inscripción a un evento", () => {
    expect(cat(facts({ hasDiagnostic: true, hasWebinarRegistration: true }, [inb("gracias")]))).toBe("interesada");
  });

  test("una interesada con contestador automático sigue siendo interesada", () => {
    expect(cat(facts({ hasBooking: true }, [inb("Gracias por comunicarte con Salón Bella. En breve te atenderemos.")]))).toBe(
      "interesada"
    );
  });

  test("crmVerdict solo mira el CRM", () => {
    expect(crmVerdict({ hasWebinarRegistration: true, inAddressBook: true })).toBeNull();
    expect(crmVerdict({ hasDiagnostic: true })?.category).toBe("interesada");
  });
});

describe("comunidad (eventos)", () => {
  test("se inscribió a la masterclass y solo dio las gracias", () => {
    const v = classifyByRules(
      facts({ hasWebinarRegistration: true }, [
        out("Hoy es la masterclass a las 7 pm 💛", { source: "recordatorio:24h" }),
        inb("Gracias Dayana!! 🙏🙏 Ahí estaré"),
        inb("Bendiciones, me encantó la clase ❤️"),
      ])
    );
    expect(v).toEqual({ category: "comunidad", confidence: 0.88, reason: "Se inscribió a un evento y solo agradece o saluda" });
  });

  test("inscrita que nunca escribió (solo invitaciones) → comunidad", () => {
    expect(classifyByRules(facts({ hasWebinarRegistration: true }, [out("Te esperamos hoy", { source: "bulk:abc" })]))).toEqual({
      category: "comunidad",
      confidence: 0.8,
      reason: "Se inscribió a un evento; nunca escribió",
    });
  });

  test("solo stickers y emojis cuentan como agradecer", () => {
    expect(cat(facts({ communityMember: true }, [inb(null, { attachments: [{ kind: "sticker" }] }), inb("🙏❤️")]))).toBe(
      "comunidad"
    );
  });

  test("su WhatsApp Business contestó solo: sigue siendo comunidad", () => {
    const v = classifyByRules(
      facts({ hasWebinarRegistration: true }, [
        inb("¡Hola! Gracias por comunicarte con Uñas Divinas. Nuestro horario de atención es de lunes a sábado."),
      ])
    );
    expect(v?.category).toBe("comunidad");
    expect(v?.reason).toContain("respuesta automática");
  });

  test("una foto no es un agradecimiento (puede ser un comprobante)", () => {
    expect(classifyByRules(facts({ hasWebinarRegistration: true }, [inb("", { attachments: [{ kind: "image" }] })]))).toBeNull();
  });

  // Revisión: «info», preguntas, precios o un punto sin espacio no son cortesía.
  test.each([
    ["Info"],
    ["Hola, ¿info?"],
    ["Info de la sesión"],
    ["Gracias! cuanto cuesta la sesion?"],
    ["Hola.Me interesa la terapia, cuanto cuesta"],
    ["Perdí todo en criptomonedas, necesito ayuda"],
    ["Gracias! Y cuánto cuesta la terapia con Dayana?"],
  ])("inscrita que escribe «%s» → lo decide el modelo", (body) => {
    expect(classifyByRules(facts({ hasWebinarRegistration: true }, [inb(body)]))).toBeNull();
  });

  test("en eventos, solo se descartan su contestador y los códigos (no la publicidad)", () => {
    expect(
      classifyByRules(facts({ hasWebinarRegistration: true }, [inb("Gracias!"), inb("https://bit.ly/oferta-zapatos")]))
    ).toBeNull();
  });
});

describe("negocio: solo códigos y notificaciones de verdad", () => {
  test("código de verificación", () => {
    expect(classifyByRules(only("Tu código de verificación es 482913. No lo compartas con nadie."))).toEqual({
      category: "negocio",
      confidence: 0.95,
      reason: "Código de verificación",
    });
  });

  test("código de seguridad con el formato de WhatsApp (123-456)", () => {
    expect(classifyByRules(only("Tu código de seguridad de WhatsApp es 123-456"))?.reason).toBe("Código de verificación");
  });

  test("«no compartas este código»", () => {
    expect(negocioSignal("Usa 5531 para entrar. No compartas este código.")?.kind).toBe("otp");
  });

  test("notificación de banco con monto: «Bancolombia te informa compra por $45.000»", () => {
    expect(classifyByRules(only("Bancolombia te informa compra por $45.000 en EXITO. Si no fuiste tú llama al 01800"))).toEqual({
      category: "negocio",
      confidence: 0.95,
      reason: "Notificación de Bancolombia",
    });
    expect(negocioSignal("Nequi: Recibiste $50.000 de JUAN PEREZ")?.kind).toBe("notification");
  });

  test("su contestador + códigos: el contestador no cuenta, los códigos sí", () => {
    expect(cat(only("Gracias por comunicarte con Banco X, en breve te atenderemos", "Tu código de acceso es 99812"))).toBe(
      "negocio"
    );
  });

  test("el banco guardado en la libreta sigue siendo negocio", () => {
    expect(cat(facts({ inAddressBook: true }, [inb("Tu código de acceso es 99812")]))).toBe("negocio");
  });

  // Revisión H3: pagos, una marca suelta o un código dentro de una conversación → el modelo.
  test.each([
    [["Hola", "Ya transferí, el código: 84736251"]],
    [["Nequi: 3001234567 ahi te pago?"]],
    [["Bancolombia - ya te consigne lo de la sesion"]],
    [["Hola Dayana, quería preguntarte por las sesiones", "me llegó esto: tu código es 4455"]],
  ])("%j no se decide como negocio", (bodies) => {
    expect(classifyByRules(only(...bodies))).toBeNull();
  });
});

describe("lo que antes silenciaba por error (revisión) → el modelo", () => {
  // H1: un punto sin espacio no es un enlace.
  test.each([
    ["Hola.Me interesa la terapia"],
    ["Buenas tardes.Estoy interesada en la terapia"],
    ["Hola.Como funciona la terapia?"],
    ["Gracias.Pero cuanto cuesta"],
  ])("«%s»: ni enlace ni negocio", (body) => {
    expect(findUrls(body)).toEqual([]);
    expect(negocioSignal(body)).toBeNull();
    expect(classifyByRules(only(body))).toBeNull();
  });

  // H2: frases normales de terapia con palabras de spam / contestador / bot.
  test.each([
    ["Perdí todo mi dinero en criptomonedas y no puedo dormir, necesito ayuda"],
    ["Hola Dayana, trabajo en trading y tengo mucha ansiedad"],
    ["Me rechazaron una oferta de trabajo y estoy deprimida"],
    ["Mi esposo trabaja desde casa y peleamos todo el dia"],
    ["Mi pareja gana dinero y no me da nada, me siento sola"],
    ["Que hago para dejar de recibir maltrato de mi mama"],
    ["Dayana has ganado mi confianza, quiero empezar"],
    ["¿El horario de atención es de lunes a viernes?"],
    ["Me llegó un correo que dice que su compra fue aprobada, ¿ya tengo acceso al curso?"],
    ["No se si tomar terapia o el curso, elige la opcion que me recomiendes"],
    ["¿Tienes un catálogo de servicios? quiero ver tu catalogo"],
    ["Hola! bienvenida a nuestra familia jaja, soy la prima de Dayana"],
    ["Hola, te escribo porque mi hija necesita terapia. ¿En qué podemos ayudarle a ella?"],
    ["Hola, ¿tu paquete de 4 sesiones está en promoción?"],
    ["¿Tienes alguna oferta especial este mes?"],
    ["¿Me das 10% de descuento si pago hoy?"],
    ["No estamos disponibles el sábado, ¿puede ser el lunes?"],
  ])("«%s» no parece de empresa", (body) => {
    expect(negocioSignal(body)).toBeNull();
    expect(classifyByRules(only(body))).toBeNull();
  });

  test("H3: su contestador + «quiero info de la terapia» → el modelo", () => {
    expect(
      classifyByRules(only("Gracias por comunicarte con Spa Luz. En breve te atenderemos", "Hola Dayana, quiero info de la terapia"))
    ).toBeNull();
    expect(
      classifyByRules(
        only("Gracias por comunicarte con Spa Luz", "hola quiero agendar", "Gracias por comunicarte con Spa Luz", "cuanto cuesta?")
      )
    ).toBeNull();
  });

  test("H4: la libreta del celular sola nunca decide «personal»", () => {
    expect(classifyByRules(facts({ inAddressBook: true }, [inb("Hola Dayana, quiero agendar una sesión, ¿cuánto cuesta?")]))).toBeNull();
    expect(classifyByRules(facts({ inAddressBook: true }, [inb("Gracias Dayana!")]))).toBeNull();
    expect(classifyByRules(facts({ inAddressBook: true }, [inb("Hola tía, ¿vienes el domingo?")]))).toBeNull();
  });

  test("solo respuestas automáticas, bots, publicidad o enlaces: pista, no decisión", () => {
    expect(classifyByRules(only("Hola 👋 recibimos tu mensaje, en breve te atenderemos."))).toBeNull();
    expect(classifyByRules(only("Este es un mensaje automático. Por favor no responda a este mensaje."))).toBeNull();
    expect(classifyByRules(only("https://bit.ly/oferta-zapatos"))).toBeNull();
    expect(classifyByRules(only("eltiempo.com/salud/ansiedad-123"))).toBeNull();
    expect(
      classifyByRules(
        only("Mira esto: Descuento exclusivo por tiempo limitado en zapatos", "jaja sera que compro? te cuento que me fue bien en la sesion")
      )
    ).toBeNull();
  });

  test("perfil con nombre de marca: pista, no decisión; apellidos y cargos no son marca", () => {
    expect(classifyByRules(facts({}, [inb("Hola")], { participantName: "Rappi Colombia" }))).toBeNull();
    expect(brandProfile("Rappi Colombia")).toBe("Rappi");
    expect(brandProfile("Santander López")).toBeNull();
    expect(brandProfile("Coordinadora Academica")).toBeNull();
    expect(brandProfile("Tigo Pérez")).toBeNull();
    expect(brandProfile("Santander")).toBe("Santander");
    expect(brandProfile("Didi")).toBeNull();
    expect(brandProfile("Laura Gómez")).toBeNull();
  });
});

describe("pistas para el modelo", () => {
  test("lo que parece de empresa se cuenta, sin decidir", () => {
    const hints = signalHints({
      signals: { inAddressBook: true },
      participantName: "Bancolombia",
      messages: [
        inb("Gracias por comunicarte con Spa Luz. En breve te atenderemos"),
        inb("Hola Dayana, quiero info de la terapia"),
        inb("https://bit.ly/x"),
      ],
    });
    expect(hints).toContain("El nombre de perfil de WhatsApp parece de una empresa (Bancolombia).");
    expect(hints.some((h) => h.includes("libreta") && h.includes("clientas"))).toBe(true);
    expect(hints).toContain(
      "1 de 3 mensajes de la persona parecen una respuesta automática de empresa (puede ser el contestador de su propio negocio)."
    );
    expect(hints).toContain("1 de 3 mensajes de la persona son solo un enlace.");
  });

  test("el nombre de perfil de una persona NO va al modelo", () => {
    expect(signalHints({ signals: {}, participantName: "Ana María Ruiz" })).toEqual(["No hay nada de esta persona en el CRM."]);
  });

  test("evento", () => {
    expect(signalHints({ signals: { hasWebinarRegistration: true } })).toEqual([
      "Se inscribió a un evento gratuito de Dayana (masterclass / clase en vivo).",
    ]);
  });
});

describe("nunca escribió y dudosos", () => {
  test("nunca escribió y no hay nada en el CRM → otro", () => {
    expect(classifyByRules(facts({}, [out("Hola, ¿cómo vas?", { isEcho: true })]))).toEqual({
      category: "otro",
      confidence: 0.7,
      reason: "Nunca escribió: solo le escribimos nosotros",
    });
  });

  test("una reacción (aviso gris) no cuenta como escribir", () => {
    expect(cat(facts({}, [inb("Reaccionó ❤️", { kind: "system" }), out("Te espero")]))).toBe("otro");
  });

  test("escribió hace mucho (fuera de los mensajes cargados): no es «nunca escribió»", () => {
    expect(classifyByRules(facts({}, [out("¿Seguimos?")], { everWrote: true }))).toBeNull();
  });

  test("pregunta por la terapia o solo «gracias» sin nada en el CRM → el modelo", () => {
    expect(classifyByRules(only("Hola, vi tu video en TikTok. ¿Cuánto cuesta una sesión?"))).toBeNull();
    expect(classifyByRules(only("Gracias"))).toBeNull();
  });
});

describe("revisar y silenciar", () => {
  test("umbral más exigente para lo que silencia", () => {
    expect(needsReview("negocio", 0.85)).toBe(true);
    expect(needsReview("personal", 0.9)).toBe(false);
    expect(needsReview("interesada", 0.75)).toBe(false);
    expect(needsReview("comunidad", 0.6)).toBe(true);
    expect(needsReview("otro", 0.7)).toBe(false);
  });

  test("isSilencingCategory: solo lo seguro silencia", () => {
    const base = { categoryConfidence: 0.95, categoryReview: false };
    expect(isSilencingCategory({ ...base, category: "personal", categorySource: "manual" })).toBe(true);
    expect(isSilencingCategory({ ...base, category: "equipo", categorySource: "rule" })).toBe(true);
    expect(isSilencingCategory({ ...base, category: "negocio", categorySource: "rule" })).toBe(true);
    expect(isSilencingCategory({ ...base, category: "negocio", categorySource: "ai" })).toBe(true);
    expect(isSilencingCategory({ ...base, category: "personal", categorySource: "ai" })).toBe(true);
    // La IA con dudas, o diciendo «equipo», no silencia.
    expect(
      isSilencingCategory({ category: "negocio", categorySource: "ai", categoryConfidence: 0.85, categoryReview: false })
    ).toBe(false);
    expect(isSilencingCategory({ ...base, category: "negocio", categorySource: "ai", categoryReview: true })).toBe(false);
    expect(isSilencingCategory({ ...base, category: "equipo", categorySource: "ai" })).toBe(false);
    // Una regla vieja que decía «personal» tampoco.
    expect(isSilencingCategory({ ...base, category: "personal", categorySource: "rule" })).toBe(false);
    // Lo que no silencia, nunca.
    expect(isSilencingCategory({ ...base, category: "interesada", categorySource: "manual" })).toBe(false);
    expect(isSilencingCategory({ category: null, categorySource: null })).toBe(false);
  });
});

describe("teléfonos del equipo", () => {
  test("se guardan limpios, sin repetidos; sin código de país se rechazan", () => {
    expect(parseTeamPhones('["+57 300 123 4567", "573001234567", "abc", "+52 55 1234 5678"]')).toEqual([
      "+573001234567",
      "+525512345678",
    ]);
    expect(parseTeamPhones("no es json")).toEqual([]);
    expect(parseTeamPhones(null)).toEqual([]);
    expect(normalizeTeamPhone("300 123 4567")).toBe("+573001234567"); // celular de Colombia
    expect(normalizeTeamPhone("12345678")).toBeNull(); // sin código de país
    expect(normalizeTeamPhone("55 1234 5678")).toBeNull();
    expect(normalizeTeamPhone("+1 555 123 4567")).toBe("+15551234567");
  });

  test("México y Argentina: el chat llega con 521 / 549", () => {
    expect(isTeamThread("5215512345678", ["+525512345678"])).toBe(true);
    expect(isTeamThread("5491122334455", ["+541122334455"])).toBe(true);
    expect(isTeamThread("573001234567", ["+573001234567"])).toBe(true);
    expect(isTeamThread("573001234568", ["+573001234567"])).toBe(false);
    expect(isTeamThread("PE.2290670648352185", ["+573001234567"])).toBe(false);
  });
});

describe("piezas", () => {
  test("isCourtesyMessage", () => {
    expect(isCourtesyMessage(inb("Muchísimas graciaaaas 🙏 bendiciones"))).toBe(true);
    expect(isCourtesyMessage(inb("jajaja amén"))).toBe(true);
    expect(isCourtesyMessage(inb("Gracias, quiero más información de la terapia"))).toBe(false);
    expect(isCourtesyMessage(inb("ok", { attachments: [{ kind: "audio" }] }))).toBe(false);
    expect(isCourtesyMessage(inb("Info"))).toBe(false);
    expect(isCourtesyMessage(inb("Hola, ¿cómo estás?"))).toBe(false);
  });

  test("personMessages ignora ecos, salientes y avisos", () => {
    const list = [inb("hola"), inb("eco", { isEcho: true }), out("respuesta"), inb("reacción", { kind: "system" }), inb("   ")];
    expect(personMessages(list).map((m) => m.body)).toEqual(["hola"]);
  });

  test("findUrls: enlaces de verdad", () => {
    expect(findUrls("mira https://www.instagram.com/reel/abc")).toEqual(["https://www.instagram.com/reel/abc"]);
    expect(findUrls("entra a www.ejemplo.com hoy")).toEqual(["www.ejemplo.com"]);
    expect(findUrls("eltiempo.com/salud/x y ya")).toEqual(["eltiempo.com/salud/x"]);
    expect(findUrls("Hola.Me interesa")).toEqual([]);
    expect(findUrls("hola.me interesa")).toEqual([]);
  });

  test("lo demás que parece de empresa (pistas)", () => {
    expect(negocioSignal("Hola 👋 recibimos tu mensaje, en breve te atenderemos.")?.kind).toBe("auto");
    expect(negocioSignal("Bienvenido 🤖 Selecciona una opción: 1. Ventas 2. Soporte")?.kind).toBe("bot");
    expect(negocioSignal("🔥 Gana dinero desde casa con copy trading. Bono en tu primer depósito del 100%")?.kind).toBe("spam");
    expect(negocioSignal("Aprovecha nuestra oferta: hasta 50% de descuento https://tienda.com/promo")?.kind).toBe("spam");
    expect(negocioSignal("Hola, ¿en qué podemos ayudarte hoy?")).toBeNull(); // pregunta: puede ser una persona
    expect(negocioSignal("jaja ¿es un mensaje automático?")).toBeNull();
    expect(negocioSignal("mira esto https://www.instagram.com/reel/abc123")).toBeNull();
    expect(negocioSignal("https://mpago.la/2xYz9")).toBeNull();
    expect(negocioSignal("Ya te pagué por Nequi, ahorita te mando el comprobante")).toBeNull();
    expect(negocioSignal("Claro: ahí estaré")).toBeNull();
    expect(negocioSignal("Hola, no me llega el código de verificación para entrar")).toBeNull();
  });
});
