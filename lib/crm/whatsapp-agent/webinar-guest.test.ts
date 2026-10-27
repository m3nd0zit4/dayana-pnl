import { describe, expect, test } from "bun:test";

import {
  acknowledgesOnly,
  asksForProcess,
  funnelsGuest,
  guestEventCounts,
  guestLine,
  guestReply,
  guestWelcome,
  wantsProcess,
} from "./webinar-guest";

const NOW = new Date("2026-10-22T15:00:00Z").getTime();
const event = {
  eventLabel: "Webinar Gratuito",
  headline: "Webinar Gratuito",
  startsAt: new Date("2026-10-25T14:30:00Z"),
  startsAtHasTime: true,
};
const CONFIRMATION =
  "Hola Miroslava, te escribimos porque te inscribiste en «Webinar Gratuito». Fecha: domingo 25 de octubre Enlace para ingresar: https://meet.google.com/mwy-ootz-hge";

const out = (body: string) => ({ direction: "OUTBOUND" as const, body });
const inb = (body: string, sentAt?: Date) => ({ direction: "INBOUND" as const, body, sentAt });

describe("asksForProcess", () => {
  // Chats reales (producción, 16–21 oct).
  test.each([
    "Hola guapa te vi por Tiktok y quería información de tú terapia gracias", // Raquel
    "Cómo puedo agendar", // Xime
    "Me gustaría tratarme con usted", // Claudia
    "Hola, quisiera agendar para empezar mi proceso", // Paola
    "Deseo una llamada contigo 🙏", // Naty
    "Soy de Guatemala y necesito ayuda porque ya no aguanto más con la ansiedad que tengo", // 13 MS
    "Hola Dayana, vengo desde la web y quiero más información.", // botón del sitio
    "Hola Dayana, vengo desde la web. Quiero conocer más sobre el proceso.", // pie de página
    "Hola Dayana, te escribo desde tu página de enlaces.", // /enlaces
    "Claro que si, debo de continuar en sesiones.", // C Fernández
    "¿Cuánto cobras por sesión?",
    "Quiero algo personalizado",
    "Me gustaría una cita con Dayana",
    // Revisión 22-oct.
    "Quisiera hablar con Dayana sobre mi ansiedad",
    "Quisiera info del acompañamiento",
    "¿Cuánto cuesta una sesión?",
    "¿Me puedes atender?",
    // Mildred, 23-oct: el código le cambió la respuesta por «Hola Mildred, te bendigo».
    "Hola Dra Dayana muchas gracias \nQué precio tiene la consulta o cómo trabajas ?",
    "Quiero quítarme creencias limitantes, pena, rabia, dolor, tristeza.",
    "¿Cuánto vale la consulta?",
    "Qué valor tienen las sesiones",
    "¿Cómo trabaja Dayana?",
    "¿En qué consiste tu método?",
    "Necesito sanar la relación con mi madre",
    // Gueiby, 24-oct: el código le cambió la llamada por «Te esperamos el domingo».
    "Cual es el costo de una secion",
    "me gustaria una evalucion para mi hijo",
  ])("pide algo personal: %s", (text) => {
    expect(asksForProcess(text)).toBe(true);
  });

  test.each([
    "Buen día, muchas gracias", // Miroslava
    "Gracias",
    "Si asistire", // Ana
    "Si puedo", // Caicedo
    "Ok. Super bien. Gracias",
    "Si si me interesa, muchas gracias", // Guada: el webinar
    "Holaaaaa Si puedo Asistir Dios mediante",
    "🎤 Quería hacerle una consulta, eh, por favor. El día 25 voy a estar en un evento del trabajo", // Patricia: una pregunta
    "Para que fecha sería",
    "USA. Atlanta ga Q hora sera Disculpe",
    "Muchas gracias x su atención x fa puede informarme se m inscribí en el webinar?",
    "La clase gratuita del 25 de octubre",
    "¿Tiene algún costo?",
    "Ya lo agendé en mi calendario",
    "Gracias por comunicarte con Candy's Pet Shop Boutique. ¿Cómo podemos ayudarte?", // respuesta automática de una empresa
    // Revisión 22-oct.
    "¿Podré tener las sesiones grabadas?",
    "¿Cómo puedo seguir el proceso del webinar?",
    "No me llega el enlace, necesito ayuda",
    "Vengo de la página del webinar, me inscribí",
    // Revisión 23-oct: el valor del evento no es el de una sesión con Dayana.
    "¿La sesión del domingo tiene costo?",
    "¿Cuánto cuesta el webinar?",
    "Quiero aprender mucho en el webinar",
    "¿Cómo funciona el evento?",
    // Nuestros mensajes le dicen «la sesión» al webinar (revisión 23-oct).
    "¿La sesión del sábado tiene costo?",
    "¿La sesión de hoy tiene algún costo?",
    "¿Tiene algún costo la sesión?",
    "¿La sesión de mañana es gratis o tiene costo?",
    "¿Cuánto es la duración de la sesión?",
    "¿Cómo funciona la sesión del domingo?",
    "¿En qué consiste la sesión?",
    "Gracias por el valor de esta sesión tan linda",
    "Quiero salir de la duda, ¿a qué hora es?",
    "Ya hice la autoevaluación",
    "¿La secion del domingo tiene costo?",
  ])("no pide nada personal: %s", (text) => {
    expect(asksForProcess(text)).toBe(false);
  });
});

describe("wantsProcess", () => {
  test("solo agradeció la confirmación del webinar (Miroslava): no", () => {
    expect(wantsProcess([out(CONFIRMATION), inb("Buen día, muchas gracias")], NOW)).toBe(false);
  });

  test("venía del webinar y después pidió información de la terapia (Raquel): sí", () => {
    expect(
      wantsProcess([out(CONFIRMATION), inb("Hola guapa te vi por Tiktok y quería información de tú terapia gracias")], NOW)
    ).toBe(true);
  });

  test("dijo que sí a la llamada gratis que se le ofreció: sí", () => {
    const lines = [
      out(CONFIRMATION),
      inb("Gracias"),
      out("Te entiendo. Si quieres, te agendo una llamada gratis de 15 minutos con Dayana."),
      inb("Sí, por favor"),
    ];
    expect(wantsProcess(lines, NOW)).toBe(true);
  });

  test("«sí, gracias» a la bienvenida con la puerta no la abre; «me interesa» sí", () => {
    const welcome = out(
      "Con gusto. Te damos la bienvenida: te esperamos en «Webinar Gratuito» el domingo, 25 de octubre. Si en algún momento quieres un proceso personalizado con Dayana, me escribes por aquí."
    );
    expect(wantsProcess([out(CONFIRMATION), inb("Gracias"), welcome, inb("Sí, gracias, ahí estaré")], NOW)).toBe(false);
    expect(wantsProcess([out(CONFIRMATION), inb("Gracias"), welcome, inb("Sí me interesa")], NOW)).toBe(true);
    expect(wantsProcess([out(CONFIRMATION), inb("Gracias"), welcome, inb("Me gustaría ir")], NOW)).toBe(false);
  });

  test("la puerta como pregunta: un «sí» la abre", () => {
    const lines = [
      out(CONFIRMATION),
      inb("Estoy pasando por un momento difícil con mi pareja"),
      out("Te entiendo. Eso es justo lo que Dayana trabaja. ¿Quieres un proceso personalizado con Dayana?"),
      inb("Sí"),
    ];
    expect(wantsProcess(lines, NOW)).toBe(true);
  });

  test("la asistente pregunta con sus palabras si quiere trabajarlo con Dayana: un «sí» la abre (revisión 22-oct)", () => {
    const lines = [
      out(CONFIRMATION),
      inb("Tengo mucha ansiedad y quiero sanar"),
      out("Te entiendo. ¿Te gustaría trabajarlo con Dayana?"),
      inb("Sí"),
    ];
    expect(wantsProcess(lines, NOW)).toBe(true);
    const own = [out(CONFIRMATION), inb("Tengo mucha ansiedad"), out("Eso es justo lo que se trabaja. ¿Te gustaría sanarlo?"), inb("Sí quiero")];
    expect(wantsProcess(own, NOW)).toBe(true);
  });

  test("un «sí quiero» a una pregunta del evento no es un proceso", () => {
    expect(wantsProcess([out(CONFIRMATION), inb("No encuentro el enlace"), out("¿Quieres que te reenvíe el enlace?"), inb("Sí quiero")], NOW)).toBe(false);
    expect(wantsProcess([out(CONFIRMATION), inb("Gracias"), out("¿Te esperamos el domingo en la sesión?"), inb("Sí")], NOW)).toBe(false);
  });

  test("preguntó el precio de la consulta y cómo trabaja Dayana (Mildred, 23-oct): sí", () => {
    const lines = [
      out(CONFIRMATION),
      inb("Hola Dra Dayana muchas gracias \nQué precio tiene la consulta o cómo trabajas ?"),
      out("Hola Mildred, te bendigo."),
      inb("Quiero quítarme creencias limitantes, pena, rabia, dolor, tristeza."),
    ];
    expect(wantsProcess(lines, NOW)).toBe(true);
    expect(wantsProcess(lines.slice(0, 2), NOW)).toBe(true);
  });

  test("lo que pidió hace más de un mes ya no cuenta", () => {
    const old = new Date(NOW - 45 * 24 * 3600_000);
    expect(wantsProcess([inb("Quiero información de la terapia", old), out(CONFIRMATION), inb("Gracias")], NOW)).toBe(false);
  });
});

describe("guestEventCounts", () => {
  test("cuenta antes del evento y hasta una semana después", () => {
    expect(guestEventCounts(event, NOW)).toBe(true);
    expect(guestEventCounts({ startsAt: null }, NOW)).toBe(true);
    expect(guestEventCounts({ startsAt: new Date(NOW - 6 * 24 * 3600_000) }, NOW)).toBe(true);
    expect(guestEventCounts({ startsAt: new Date(NOW - 8 * 24 * 3600_000) }, NOW)).toBe(false);
  });
});

describe("funnelsGuest", () => {
  test.each([
    "Hola Miroslava, te bendigo. Soy la asistente de Dayana. ¿Desde qué país me escribes?",
    "Con gusto, Ana. ¿Desde qué país me escribes?",
    "Hola Miroslava, te bendigo. Cuéntame, ¿qué es lo que te motiva a buscar ayuda en este momento?",
    "Vale perfecto, Alexandra. ¿Qué te motivó a inscribirte en el webinar?",
    "Si quieres, te agendo una llamada gratis de 15 minutos con Dayana, sin costo ni compromiso.",
    "Hola, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?",
    "¿De qué ciudad de México me escribes?",
    "¿Cuánto tiempo más quieres seguir así?",
    "¿Te gustaría que revisemos una fecha para esa llamada?",
    "Caicedo, el «Webinar Gratuito» es el domingo, 18 de octubre. ¿Te gustaría que veamos una cita?", // eval 23-oct
  ])("la mete en el embudo: %s", (reply) => {
    expect(funnelsGuest(reply, ["Gracias"])).toBe(true);
  });

  test.each([
    "Con gusto, Ana. Te damos la bienvenida: te esperamos en «Webinar Gratuito» el domingo, 25 de octubre. Te bendigo 🙏",
    "Amén Erika, te esperamos el domingo con todo el corazón. 🙏",
    "Con gusto, Guada 🙏 Nos vemos el domingo.",
    "Es el domingo 25 de octubre a las 9:30 a. m. hora de Colombia (8:30 a. m. en México).",
    "Es en vivo por Meet, no es una llamada.",
    "Dayana tiene la agenda muy llena esta semana, pero te esperamos el domingo.",
  ])("no la mete: %s", (reply) => {
    expect(funnelsGuest(reply, ["Gracias"])).toBe(false);
  });

  test("preguntar el país vale si ella preguntó la hora", () => {
    expect(funnelsGuest("Con gusto. ¿Desde qué país te conectas, para decirte la hora?", ["¿A qué hora es?"])).toBe(false);
  });
});

describe("acknowledgesOnly", () => {
  for (const msgs of [["Gracias"], ["Gracias", "Si asistire"], ["Si puedo"], ["Buen día, muchas gracias"], ["🙏🙏"], ["Holaaaaa Si puedo Asistir Dios mediante"]]) {
    test(`solo agradece o confirma: ${msgs.join(" / ")}`, () => {
      expect(acknowledgesOnly(msgs)).toBe(true);
    });
  }

  for (const msgs of [
    ["Para que fecha sería"],
    ["¿A qué hora es?"],
    ["Si, pero no sé si pueda conectarme por el trabajo"],
    ["Gracias, quiero información de la terapia"],
    // Revisión 22-oct.
    ["quiero saber si es en vivo"],
    ["ok y el enlace"],
    ["¿sí es en vivo"],
  ]) {
    test(`pide algo: ${msgs.join(" / ")}`, () => {
      expect(acknowledgesOnly(msgs)).toBe(false);
    });
  }
});

describe("guestReply", () => {
  const opts = { firstName: "Ana", timezone: "America/Bogota", now: NOW };
  const lines = [out(CONFIRMATION), inb("Gracias"), inb("Si asistire")];

  test("«¿Desde qué país me escribes?» a un «sí asistiré» (Ana): la bienvenida", () => {
    expect(guestReply(event, "Con gusto, Ana. ¿Desde qué país me escribes?", ["Gracias", "Si asistire"], lines, opts)).toStartWith(
      "Con gusto, Ana. Te damos la bienvenida"
    );
  });

  test("«Con gusto. Te bendigo» sin la bienvenida: la bienvenida", () => {
    expect(guestReply(event, "Con gusto. Te bendigo 🙏", ["Gracias"], lines, opts)).toStartWith("Con gusto, Ana. Te damos la bienvenida");
  });

  test("ya le da la bienvenida: sale la del modelo", () => {
    expect(guestReply(event, "Amén, Ana, te esperamos el domingo con todo el corazón. 🙏", ["Gracias"], lines, opts)).toBeNull();
  });

  test("contestó la fecha y le ofreció agendar (Caicedo): solo la fecha", () => {
    const reply =
      "Es el domingo 25 de octubre a las 9:30 a. m. hora de Colombia. Si te refieres a una sesión personalizada con Dayana, la agendamos para cuando prefieras.";
    expect(guestReply(event, reply, ["Para que fecha sería"], lines, opts)).toBe("Es el domingo 25 de octubre a las 9:30 a. m. hora de Colombia.");
  });

  test("preguntó la fecha y lo que queda no la dice: la bienvenida con día y hora", () => {
    const reply = "Si te refieres a un proceso personalizado con Dayana, me cuentas. ¿Te agendo una llamada gratis?";
    const welcomed = [...lines, out("Con gusto, Ana. Te damos la bienvenida: te esperamos en «Webinar Gratuito» el domingo, 25 de octubre.")];
    expect(guestReply(event, reply, ["Para que fecha sería"], welcomed, opts)).toBe(
      "Con gusto, Ana 🙏 Te esperamos el domingo, 25 de octubre, a las 9:30 a. m. (hora de Colombia)."
    );
  });

  test("después del evento, un agradecimiento con la respuesta del modelo: sale la del modelo", () => {
    const after = new Date("2026-10-26T15:00:00Z").getTime();
    expect(guestReply(event, "Con gusto, Ana. Gracias por acompañarnos 🙏", ["Gracias por todo"], lines, { ...opts, now: after })).toBeNull();
  });
});

describe("guestWelcome", () => {
  test("primera vez: bienvenida, la fecha y la puerta", () => {
    expect(guestWelcome(event, [out(CONFIRMATION), inb("Gracias")], { firstName: "Ana", timezone: "America/Bogota", now: NOW })).toBe(
      "Con gusto, Ana. Te damos la bienvenida: te esperamos en «Webinar Gratuito» el domingo, 25 de octubre, a las 9:30 a. m. (hora de Colombia). Si en algún momento quieres un proceso personalizado con Dayana, me escribes por aquí. Te bendigo 🙏"
    );
  });

  test("sin nombre seguro, sin nombre", () => {
    expect(guestWelcome(event, [inb("Gracias")], { firstName: null, timezone: "America/Bogota", now: NOW })).toStartWith(
      "Con gusto. Te damos la bienvenida"
    );
  });

  test("ya le dio la bienvenida: corto, sin repetir la puerta", () => {
    const lines = [
      out(CONFIRMATION),
      inb("Gracias"),
      out("Con gusto. Te damos la bienvenida: te esperamos en «Webinar Gratuito» el domingo, 25 de octubre. Si en algún momento quieres un proceso personalizado con Dayana, me escribes por aquí."),
      inb("Bendiciones"),
    ];
    expect(guestWelcome(event, lines, { firstName: "Ana", timezone: "America/Bogota", now: NOW })).toBe(
      "Con gusto, Ana 🙏 Te esperamos el domingo, 25 de octubre, a las 9:30 a. m. (hora de Colombia)."
    );
  });

  test("el evento ya pasó: agradece y deja la puerta", () => {
    const after = new Date("2026-10-26T15:00:00Z").getTime();
    expect(guestWelcome(event, [inb("Gracias por todo")], { firstName: null, timezone: "America/Bogota", now: after })).toBe(
      "Con gusto. Si en algún momento quieres un proceso personalizado con Dayana, me escribes por aquí. Te bendigo 🙏"
    );
  });
});

describe("guestLine", () => {
  test("dice el evento, que no aplica la llamada gratis y la puerta una vez", () => {
    const line = guestLine(event, [out(CONFIRMATION), inb("Gracias")], { timezone: "America/Bogota", now: NOW });
    expect(line).toContain("INSCRITA EN UN EVENTO GRATUITO");
    expect(line).toContain("domingo, 25 de octubre, 9:30 a. m. hora de Colombia");
    expect(line).toContain("NO le aplica el flujo de PERSONA NUEVA");
    expect(line).toContain("proceso personalizado");
    const later = guestLine(
      event,
      [out("Con gusto. Si en algún momento quieres un proceso personalizado con Dayana, me escribes por aquí."), inb("Gracias")],
      { timezone: "America/Bogota", now: NOW }
    );
    expect(later).not.toContain("cierra con");
  });
});
