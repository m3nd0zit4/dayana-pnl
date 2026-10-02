import { describe, expect, test } from "bun:test";
import {
  brandProfile,
  classifyByRules,
  isCourtesyMessage,
  isTeamThread,
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

describe("cliente y equipo (lo que dice el CRM manda)", () => {
  test("pagó un paquete → cliente, aunque escriba un código", () => {
    const v = classifyByRules(facts({ hasPaidEnrollment: true, paidKind: "THERAPY" }, [inb("Tu código es 123456")]));
    expect(v).toEqual({ category: "cliente", confidence: 0.98, reason: "Pagó un paquete" });
  });

  test("pagó el curso: el motivo lo dice", () => {
    expect(classifyByRules(facts({ hasPaidEnrollment: true, paidKind: "COURSE" }, []))?.reason).toBe("Pagó el curso");
  });

  test("un pago aprobado sin matrícula activa también es cliente", () => {
    const v = classifyByRules(facts({ hasApprovedPayment: true }, [inb("hola")]));
    expect(v?.category).toBe("cliente");
    expect(v?.reason).toBe("Tiene un pago aprobado");
  });

  test("sesiones de paquete en el calendario (3/8) → cliente", () => {
    expect(cat(facts({ hasTherapySession: true }, []))).toBe("cliente");
  });

  test("número del equipo → equipo, por encima de todo", () => {
    const v = classifyByRules(facts({ isTeamPhone: true, hasPaidEnrollment: true }, [inb("Ya subí el video")]));
    expect(v).toEqual({ category: "equipo", confidence: 1, reason: "Número del equipo" });
  });
});

describe("interesada (CRM)", () => {
  test("agendó la llamada gratis", () => {
    expect(classifyByRules(facts({ hasBooking: true }, [inb("listo, gracias")]))?.reason).toBe("Agendó la llamada gratis");
  });

  test("hizo la autoevaluación, aunque nunca escribió", () => {
    const v = classifyByRules(facts({ hasDiagnostic: true }, [out("Hola María, te bendigo 💛")]));
    expect(v?.category).toBe("interesada");
    expect(v?.reason).toBe("Hizo la autoevaluación");
  });

  test("empezó a pagar y no terminó", () => {
    expect(classifyByRules(facts({ hasPendingPayment: true }, []))?.reason).toBe("Empezó a pagar y no terminó");
  });

  test("lead de un servicio", () => {
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
    expect(v?.category).toBe("comunidad");
    expect(v?.reason).toBe("Se inscribió a un evento y solo agradece o saluda");
  });

  test("inscrita que nunca escribió (solo invitaciones) → comunidad", () => {
    const v = classifyByRules(facts({ hasWebinarRegistration: true }, [out("Te esperamos hoy", { source: "bulk:abc" })]));
    expect(v).toEqual({ category: "comunidad", confidence: 0.8, reason: "Se inscribió a un evento; nunca escribió" });
  });

  test("inscrita que pregunta el precio de la terapia → lo decide el modelo", () => {
    expect(
      classifyByRules(facts({ hasWebinarRegistration: true }, [inb("Gracias! Y cuánto cuesta la terapia con Dayana?")]))
    ).toBeNull();
  });

  test("solo stickers y emojis cuentan como agradecer", () => {
    expect(
      cat(facts({ communityMember: true }, [inb(null, { attachments: [{ kind: "sticker" }] }), inb("🙏❤️")]))
    ).toBe("comunidad");
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
});

describe("negocio (lo que escribió, sin señales del CRM)", () => {
  test("código de verificación", () => {
    expect(classifyByRules(facts({}, [inb("Tu código de verificación es 482913. No lo compartas con nadie.")]))).toEqual({
      category: "negocio",
      confidence: 0.95,
      reason: "Código de verificación",
    });
  });

  test("código de seguridad con el formato de WhatsApp (123-456)", () => {
    expect(classifyByRules(facts({}, [inb("Tu código de seguridad de WhatsApp es 123-456")]))?.reason).toBe(
      "Código de verificación"
    );
  });

  test("«no compartas este código»", () => {
    expect(negocioSignal("Usa 5531 para entrar. No compartas este código.")?.kind).toBe("otp");
  });

  test("respuesta automática: «en breve te atenderemos»", () => {
    expect(classifyByRules(facts({}, [inb("Hola 👋 recibimos tu mensaje, en breve te atenderemos.")]))?.reason).toBe(
      "Respuesta automática de una empresa"
    );
  });

  test("«este es un mensaje automático, no responder»", () => {
    expect(cat(facts({}, [inb("Este es un mensaje automático. Por favor no responda a este mensaje.")]))).toBe("negocio");
  });

  test("¿esto es un mensaje automático? lo pregunta una persona", () => {
    expect(negocioSignal("jaja ¿es un mensaje automático?")).toBeNull();
  });

  test("bot con menú", () => {
    expect(negocioSignal("Bienvenido 🤖 Selecciona una opción: 1. Ventas 2. Soporte")?.kind).toBe("bot");
  });

  test("notificación de banco: «Bancolombia te informa…»", () => {
    const v = classifyByRules(facts({}, [inb("Bancolombia te informa compra por $45.000 en EXITO. Si no fuiste tú llama al…")]));
    expect(v?.category).toBe("negocio");
    expect(v?.reason).toBe("Notificación de Bancolombia");
  });

  test("«Nequi: …» al principio del mensaje", () => {
    expect(negocioSignal("Nequi: Recibiste $50.000 de JUAN PEREZ")?.reason).toBe("Notificación de Nequi");
  });

  test("una clienta que dice que pagó por Nequi NO es una notificación", () => {
    expect(negocioSignal("Ya te pagué por Nequi, ahorita te mando el comprobante")).toBeNull();
    expect(negocioSignal("Claro: ahí estaré")).toBeNull();
  });

  test("spam de trading y bonos", () => {
    expect(negocioSignal("🔥 Gana dinero desde casa con copy trading. Bono en tu primer depósito del 100%")?.kind).toBe("spam");
    expect(cat(facts({}, [inb("Únete a nuestro grupo de inversión en criptomonedas, rentabilidad diaria garantizada")]))).toBe(
      "negocio"
    );
  });

  test("perfil con nombre de marca", () => {
    expect(classifyByRules(facts({}, [inb("Hola")], { participantName: "Rappi Colombia" }))?.reason).toBe(
      "Perfil de empresa: Rappi"
    );
    expect(brandProfile("Didi")).toBeNull(); // es un apodo
    expect(brandProfile("Laura Gómez")).toBeNull();
  });

  test("solo un enlace de una tienda → negocio con menos confianza", () => {
    const v = classifyByRules(facts({}, [inb("https://bit.ly/oferta-zapatos")]));
    expect(v?.category).toBe("negocio");
    expect(v?.confidence).toBe(0.75);
  });

  test("un reel de Instagram no es publicidad", () => {
    expect(negocioSignal("mira esto https://www.instagram.com/reel/abc123")).toBeNull();
  });

  test("una persona que un día reenvió un código pero conversa: lo decide el modelo", () => {
    expect(
      classifyByRules(
        facts({}, [
          inb("Hola Dayana, quería preguntarte por las sesiones"),
          inb("me llegó esto: tu código es 4455"),
          inb("no sé si es para entrar a la plataforma"),
        ])
      )
    ).toBeNull();
  });

  test("lo que pregunta una interesada no es de empresa", () => {
    expect(negocioSignal("Hola, ¿tu paquete de 4 sesiones está en promoción?")).toBeNull();
    expect(negocioSignal("¿Tienes alguna oferta especial este mes?")).toBeNull();
    expect(negocioSignal("¿Me das 10% de descuento si pago hoy?")).toBeNull();
    expect(negocioSignal("¿Cómo podemos ayudar a mi hija con la ansiedad?")).toBeNull();
    expect(negocioSignal("No estamos disponibles el sábado, ¿puede ser el lunes?")).toBeNull();
    expect(negocioSignal("https://mpago.la/2xYz9")).toBeNull();
  });

  test("las promos como afirmación sí son publicidad", () => {
    expect(negocioSignal("Aprovecha nuestra oferta: hasta 50% de descuento en toda la tienda")?.kind).toBe("spam");
    expect(negocioSignal("Hola, ¿en qué podemos ayudarte hoy?")?.kind).toBe("auto");
  });

  test("«no me llega el código de verificación» no es un código", () => {
    expect(negocioSignal("Hola, no me llega el código de verificación para entrar")).toBeNull();
  });
});

describe("personal, nunca escribió y dudosos", () => {
  test("en la libreta del celular y sin nada en el CRM → personal", () => {
    expect(classifyByRules(facts({ inAddressBook: true }, [inb("Hola tía, ¿vienes el domingo?")]))).toEqual({
      category: "personal",
      confidence: 0.85,
      reason: "Está en la libreta del celular",
    });
  });

  test("el banco guardado en la libreta sigue siendo negocio", () => {
    expect(cat(facts({ inAddressBook: true }, [inb("Tu código de acceso es 99812")]))).toBe("negocio");
  });

  test("nunca escribió y no hay nada en el CRM → otro con confianza baja", () => {
    expect(classifyByRules(facts({}, [out("Hola, ¿cómo vas?", { isEcho: true })]))).toEqual({
      category: "otro",
      confidence: 0.3,
      reason: "Nunca escribió: solo le escribimos nosotros",
    });
  });

  test("una reacción (aviso gris) no cuenta como escribir", () => {
    expect(cat(facts({}, [inb("Reaccionó ❤️", { kind: "system" }), out("Te espero")]))).toBe("otro");
  });

  test("escribió hace mucho (fuera de los mensajes cargados): no es «nunca escribió»", () => {
    expect(classifyByRules(facts({}, [out("¿Seguimos?")], { everWrote: true }))).toBeNull();
  });

  test("pregunta por la terapia sin nada en el CRM → lo decide el modelo", () => {
    expect(classifyByRules(facts({}, [inb("Hola, vi tu video en TikTok. ¿Cuánto cuesta una sesión?")]))).toBeNull();
  });

  test("solo un «gracias» sin evento ni CRM → lo decide el modelo", () => {
    expect(classifyByRules(facts({}, [inb("Gracias")]))).toBeNull();
  });
});

describe("teléfonos del equipo", () => {
  test("se guardan limpios y sin repetidos", () => {
    expect(parseTeamPhones('["+57 300 123 4567", "573001234567", "abc", "+52 55 1234 5678"]')).toEqual([
      "+573001234567",
      "+525512345678",
    ]);
    expect(parseTeamPhones("no es json")).toEqual([]);
    expect(parseTeamPhones(null)).toEqual([]);
    expect(normalizeTeamPhone("123")).toBeNull();
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
  });

  test("personMessages ignora ecos, salientes y avisos", () => {
    const list = [
      inb("hola"),
      inb("eco", { isEcho: true }),
      out("respuesta"),
      inb("reacción", { kind: "system" }),
      inb("   "),
    ];
    expect(personMessages(list).map((m) => m.body)).toEqual(["hola"]);
  });

  test("signalHints dice lo que hay y lo que no", () => {
    expect(signalHints({ signals: {}, participantName: "Ana" })).toEqual([
      "Nombre de perfil de WhatsApp: «Ana».",
      "No hay nada de esta persona en el CRM.",
    ]);
    expect(signalHints({ signals: { hasWebinarRegistration: true } })).toEqual([
      "Se inscribió a un evento gratuito de Dayana (masterclass / clase en vivo).",
    ]);
  });
});
