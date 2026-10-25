import { describe, expect, test } from "bun:test";

import {
  isWorkshopAsk,
  isWorkshopChoice,
  isWorkshopOffer,
  promisesWorkshopLink,
  saysNoWorkshop,
  titleWords,
  wantsWorkshopSpot,
  withoutWorkshopPayUrls,
  withWorkshopStep,
  WORKSHOP_CHOICE,
  workshopAskedRecently,
  workshopFlowActive,
  workshopFacts,
  workshopFollowLine,
  workshopLeadActive,
  workshopLine,
  workshopLinkReply,
  workshopLinkSent,
  workshopOfferTemplateMessage,
  workshopOfferText,
  workshopOutreachSource,
  workshopReply,
  type OpenWorkshop,
} from "./workshop-interest";

// El de producción (24-oct): solo el día (la hora de `startsAt` es un ancla).
const W: OpenWorkshop = {
  id: "w1",
  title: "Tu Sanacion con el Dinero",
  slug: "tu-sanacion-con-el-dinero",
  startsAt: new Date("2026-11-15T17:00:00Z"),
  startsAtHasTime: false,
  timezone: "America/Bogota",
  dateLabel: "15 de noviembre 2026",
  scheduleLabel: "8:30 a.m. – 4:30 p.m. · virtual",
  cardSummary: "Jornada intensiva de PNL en vivo por Google Meet.",
};
// Con su enlace de pago (25-oct: producto activo con precio).
const PAY = "https://www.dayanabeltran.com/pagar/p/taller-tu-sanacion-con-el-dinero";
const WP: OpenWorkshop = { ...W, payUrl: PAY };

describe("isWorkshopAsk: quién pregunta por el taller abierto (24-oct)", () => {
  test("lo que escribieron (y el botón de la página)", () => {
    for (const t of [
      "Buenas  tardes el costo  del taller  15 noviembre  xf me puede información",
      "Buenas tardes porfa me das info sobre el costo de taller el 15 noviembre",
      "Hola Dayana!\nCómo se hace para apuntarse al taller del 15 de noviembre?",
      "El costo del taller del 15 de noviembre?",
      "Mañana nos vemos en el webinar, gracias.\nQuiero saber el costo de el taller de sanación de el dinero ( 15 de noviembre ) y horarios",
      'Hola Dayana, me interesa inscribirme al taller "Tu Sanacion con el Dinero".',
      "quiero el taller",
      "¿el taller es virtual?",
      // Revisión 24-oct: sin la palabra «taller».
      "¿cuánto cuesta la sanación con el dinero?",
      "¿cuándo es lo del 15 de noviembre?",
    ]) {
      expect([t, isWorkshopAsk(t, W)]).toEqual([t, true]);
    }
  });
  test("lo que no: otro taller, una clienta que hace los talleres del curso, nada de taller", () => {
    for (const t of [
      "Son del taller de jabones  ?",
      "Mñn te deposito lo de este mes por favor veo las grabaciones trato de hacer los talleres muy importantes por cierto",
      "y en Dios confío que si pueda estar en alguno de tus talleres, no te perderé de vista",
      "¿Cuánto cuesta la terapia?",
      "Mi pregunta es ,para el 15 de noviembre",
      // Una palabra del título sola no: «dinero» es de todos los días.
      "no tengo dinero para la terapia, ¿cuánto cuesta?",
      "Me llego el 15 de noviembre la quincena",
      // Su proceso, aunque nombre el tema (revisión 24-oct).
      "¿cuánto cuesta la sesión de sanación con el dinero?",
      null,
    ]) {
      expect([t, isWorkshopAsk(t, W)]).toEqual([t, false]);
    }
  });
  test("las palabras del título", () => {
    expect(titleWords(W.title)).toEqual(["sanacion", "dinero"]);
  });
});

describe("workshopAskedRecently: el «sí», el país y la hora llegan después", () => {
  const now = new Date("2026-10-24T21:00:00Z").getTime();
  test("preguntó hace un rato: sigue contando; hace dos días: ya no", () => {
    const lines = [
      { direction: "INBOUND", body: "El costo del taller del 15 de noviembre?", sentAt: new Date("2026-10-24T20:27:00Z") },
      { direction: "OUTBOUND", body: "¿Desde qué país me escribes?", sentAt: new Date("2026-10-24T20:28:00Z") },
      { direction: "INBOUND", body: "Perú", sentAt: new Date("2026-10-24T20:29:00Z") },
    ];
    expect(workshopAskedRecently(lines, W, now)).toBe(true);
    expect(workshopAskedRecently(lines, W, now + 2 * 24 * 3600_000)).toBe(false);
    expect(workshopAskedRecently([{ direction: "OUTBOUND", body: "El taller del 15 de noviembre…", sentAt: null }], W, now)).toBe(false);
  });
  test("Naty: la pregunta en dos mensajes seguidos cuenta junta", () => {
    const lines = [
      { direction: "OUTBOUND", body: "No hay ningún taller programado.", sentAt: new Date("2026-10-24T20:28:00Z") },
      { direction: "INBOUND", body: "Mi pregunta es ,para el 15 de noviembre", sentAt: new Date("2026-10-24T20:40:21Z") },
      { direction: "INBOUND", body: "El taller", sentAt: new Date("2026-10-24T20:40:25Z") },
    ];
    expect(workshopAskedRecently(lines, W, now)).toBe(true);
    expect(workshopAskedRecently(lines.slice(0, 2), W, now)).toBe(false);
  });
});

describe("workshopFlowActive: la llamada para el taller solo mientras habla del taller (revisión 24-oct)", () => {
  const now = new Date("2026-10-24T21:00:00Z").getTime();
  const at = (m: number) => new Date(now - m * 60_000);
  const ask = { direction: "INBOUND", body: "El costo del taller del 15 de noviembre?", sentAt: at(30) };
  test("pregunta ahora, o le ofrecimos la llamada / las horas para el taller: sí", () => {
    expect(workshopFlowActive([ask], W, now)).toBe(true);
    const offered = [
      ask,
      { direction: "OUTBOUND", isAutoReply: true, body: "Las inscripciones están abiertas y son con una llamada con Dayana. ¿Quieres que te la separe?", sentAt: at(29) },
      { direction: "INBOUND", body: "Sí", sentAt: at(28) },
    ];
    expect(workshopFlowActive(offered, W, now)).toBe(true);
    const slots = [
      ...offered,
      { direction: "OUTBOUND", isAutoReply: true, body: "Estas son las horas\n1. Lunes 3:00 p. m.\n¿Cuál te queda mejor? Puedes responderme con el número.", sentAt: at(27) },
      { direction: "INBOUND", body: "2", sentAt: at(26) },
    ];
    expect(workshopFlowActive(slots, W, now)).toBe(true);
  });
  test("ya pasó a otra cosa: no", () => {
    const later = [
      ask,
      { direction: "OUTBOUND", isAutoReply: true, body: "Tu llamada con Dayana quedó para el lunes.", sentAt: at(20) },
      { direction: "INBOUND", body: "Gracias", sentAt: at(19) },
      { direction: "OUTBOUND", isAutoReply: true, body: "Con gusto 🙏", sentAt: at(18) },
      { direction: "INBOUND", body: "¿Cómo pago mi sesión?", sentAt: at(5) },
    ];
    expect(workshopFlowActive(later, W, now)).toBe(false);
    expect(workshopFlowActive([{ direction: "INBOUND", body: "Gracias", sentAt: at(5) }], W, now)).toBe(false);
  });
  test("una lista de horas o un «¿te la separo?» que no es del taller no reabre la llamada (revisión 24-oct)", () => {
    const otherList = [
      ask,
      { direction: "OUTBOUND", isAutoReply: true, body: "Sí, está abierto. La inscripción es con una llamada con Dayana.", sentAt: at(25) },
      { direction: "INBOUND", body: "Lo pienso", sentAt: at(24) },
      { direction: "OUTBOUND", isAutoReply: true, body: "Claro, cuando quieras.", sentAt: at(23) },
      { direction: "OUTBOUND", isAutoReply: true, body: "Estas son las horas\n1. Lunes\n¿Cuál te queda mejor?", sentAt: at(22) },
      { direction: "INBOUND", body: "1", sentAt: at(21) },
    ];
    expect(workshopFlowActive(otherList, W, now)).toBe(false);
    const separe = [ask, { direction: "OUTBOUND", isAutoReply: true, body: "¿Quieres que te la separe?", sentAt: at(20) }, { direction: "INBOUND", body: "sí", sentAt: at(19) }];
    expect(workshopFlowActive(separe, W, now)).toBe(false);
  });
});

describe("la lista de interesadas: Dayana toca «Ofrecerle la llamada» (24-oct)", () => {
  const now = new Date("2026-10-27T21:00:00Z").getTime();
  const hoursAgo = (h: number) => new Date(now - h * 3600_000);
  // Preguntó el 24 (hace 3 días): sin el mensaje de la lista ya no cuenta.
  const oldAsk = { direction: "INBOUND", body: "El costo del taller del 15 de noviembre?", sentAt: hoursAgo(72) };
  const outreach = (h: number, body = "Hola 🙏 Sobre el taller «Tu Sanacion con el Dinero» por el que preguntaste: está abierto. ¿Quieres que te la separe?") => ({
    direction: "OUTBOUND",
    isAutoReply: true,
    source: workshopOutreachSource(W),
    body,
    sentAt: hoursAgo(h),
  });
  test("su respuesta sigue lo del taller hasta 3 días después", () => {
    expect(workshopFlowActive([oldAsk, { direction: "INBOUND", body: "sí", sentAt: hoursAgo(1) }], W, now)).toBe(false);
    for (const h of [2, 30, 70]) {
      const lines = [oldAsk, outreach(h), { direction: "INBOUND", body: "sí", sentAt: hoursAgo(h - 1) }];
      expect(workshopLeadActive(lines, W, now)).toBe(true);
      expect(workshopFlowActive(lines, W, now)).toBe(true);
    }
    const stale = [oldAsk, outreach(80), { direction: "INBOUND", body: "sí", sentAt: hoursAgo(1) }];
    expect(workshopFlowActive(stale, W, now)).toBe(false);
  });
  test("después del «sí» la IA manda las horas: elegir una sigue en lo del taller", () => {
    const lines = [
      outreach(30),
      { direction: "INBOUND", body: "sí", sentAt: hoursAgo(2) },
      { direction: "OUTBOUND", isAutoReply: true, body: "Estas son las horas\n1. Lunes 3:00 p. m.\n¿Cuál te queda mejor? Puedes responderme con el número.", sentAt: hoursAgo(1.9) },
      { direction: "INBOUND", body: "1", sentAt: hoursAgo(1.8) },
    ];
    expect(workshopFlowActive(lines, W, now)).toBe(true);
  });
  test("el país, la ciudad, «¿Cuál de estas?» entre la oferta y la hora no cierran lo del taller (revisión 24-oct)", () => {
    const step = (body: string, h: number) => ({ direction: "OUTBOUND", isAutoReply: true, body, sentAt: hoursAgo(h) });
    const said = (body: string, h: number) => ({ direction: "INBOUND", body, sentAt: hoursAgo(h) });
    const country = [outreach(30), said("Sí", 3), step("Con gusto. ¿Desde qué país me escribes?", 2.9), said("Perú", 2.8)];
    expect(workshopFlowActive(country, W, now)).toBe(true);
    const narrowed = [
      ...country,
      step("Estas son las horas libres de Dayana\n1. Lunes 3:00 p. m.\n2. Martes 9:00 a. m.\n\n¿Cuál te queda mejor? Puedes responderme con el número.", 2.7),
      said("el lunes", 2.6),
      step("¿Cuál de estas?\n\n1. Lunes 3:00 p. m.", 2.5),
      said("la 1", 2.4),
    ];
    expect(workshopFlowActive(narrowed, W, now)).toBe(true);
    // Agendada (la confirmación no es un paso): se acabó.
    const booked = [...narrowed, step("Listo. Tu llamada gratis con Dayana quedó para el lunes 3:00 p. m.", 2.3), said("Gracias", 2.2)];
    expect(workshopFlowActive(booked, W, now)).toBe(false);
  });
  test("una pregunta de su proceso después de la oferta no sigue lo del taller (revisión 24-oct)", () => {
    const lines = [outreach(30), { direction: "INBOUND", body: "¿a qué cuenta pago mi terapia?", sentAt: hoursAgo(1) }];
    expect(workshopFlowActive(lines, W, now)).toBe(false);
    // Del taller sí.
    const workshopPrice = [outreach(30), { direction: "INBOUND", body: "¿y cuánto cuesta el taller?", sentAt: hoursAgo(1) }];
    expect(workshopFlowActive(workshopPrice, W, now)).toBe(true);
  });
  test("isWorkshopOffer: el mensaje de la lista o uno que habla del taller y la inscripción por llamada", () => {
    expect(isWorkshopOffer(outreach(1), W)).toBe(true);
    expect(isWorkshopOffer({ direction: "OUTBOUND", body: "El taller está abierto. La inscripción es con una llamada con Dayana." }, W)).toBe(true);
    expect(isWorkshopOffer({ direction: "OUTBOUND", body: "Te agendo una llamada gratis" }, W)).toBe(false);
    expect(isWorkshopOffer({ direction: "INBOUND", body: "La inscripción del taller es con llamada?" }, W)).toBe(false);
  });
  test("otro taller o un mensaje sin esa marca no cuentan", () => {
    const other = { ...outreach(2), source: workshopOutreachSource({ id: "otro" }) };
    expect(workshopLeadActive([other], W, now)).toBe(false);
    const plain = { ...outreach(2), source: null };
    expect(workshopLeadActive([plain], W, now)).toBe(false);
  });
  test("el mensaje sin enlace de pago: el taller, abierto y la llamada para inscribirse", () => {
    const m = workshopOfferText(W, { firstName: "Naty" });
    expect(m.startsWith("Hola Naty 🙏 Sobre el taller «Tu Sanacion con el Dinero» por el que preguntaste: está abierto y es el domingo 15 de noviembre")).toBe(true);
    expect(m).toContain("La inscripción es con una llamada con Dayana");
    expect(m.endsWith("¿Quieres que te la separe?")).toBe(true);
    expect(m).not.toMatch(/\$|USD|COP|https?:/);
    expect(workshopOfferText(W, { firstName: null }).startsWith("Hola 🙏 Sobre")).toBe(true);
  });
  test("el mensaje con enlace de pago (25-oct): pregunta si separa su cupo o agenda la llamada; sin el enlace ni el valor", () => {
    const m = workshopOfferText(WP, { firstName: "Naty" });
    expect(m.startsWith("Hola Naty 🙏 Sobre el taller «Tu Sanacion con el Dinero» por el que preguntaste: está abierto")).toBe(true);
    expect(m.endsWith(WORKSHOP_CHOICE)).toBe(true);
    expect(isWorkshopChoice(m)).toBe(true);
    expect(isWorkshopOffer({ direction: "OUTBOUND", body: m }, WP)).toBe(true);
    expect(m).not.toMatch(/\$|USD|COP|https?:/);
  });
  test("la plantilla: una línea, cabe en la variable (300) y pregunta al final", () => {
    const m = workshopOfferTemplateMessage(W);
    expect(m).not.toContain("\n");
    expect(m.length).toBeLessThanOrEqual(300);
    expect(m.endsWith("¿Quieres que te la separe?")).toBe(true);
    const long = workshopOfferTemplateMessage({ ...W, title: "Un título muy largo ".repeat(6).trim(), scheduleLabel: "8:30 a.m. – 4:30 p.m. · virtual por Google Meet con descansos" });
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long).not.toContain("8:30");
    // Un título larguísimo se acorta; la pregunta del final queda entera.
    const huge = workshopOfferTemplateMessage({ ...W, title: "Palabra ".repeat(60).trim() });
    expect(huge.length).toBeLessThanOrEqual(300);
    expect(huge.endsWith("¿Quieres que te la separe?")).toBe(true);
    expect(huge).toContain("…»");
  });
  test("la plantilla con enlace de pago: la pregunta del cupo o la llamada, entera y dentro de 300", () => {
    for (const w of [WP, { ...WP, title: "Un título muy largo ".repeat(6).trim() }, { ...WP, title: "Palabra ".repeat(60).trim() }]) {
      const m = workshopOfferTemplateMessage(w);
      expect(m.length).toBeLessThanOrEqual(300);
      expect(m).not.toContain("\n");
      expect(m.endsWith(WORKSHOP_CHOICE)).toBe(true);
    }
  });
});

describe("lo que dice", () => {
  test("los datos: el día en su zona, el horario con a. m./p. m., hora de Colombia", () => {
    expect(workshopFacts(W)).toBe("el taller «Tu Sanacion con el Dinero» es el domingo 15 de noviembre, 8:30 a. m. – 4:30 p. m., virtual (hora de Colombia)");
  });
  test("la respuesta del código: abierto + la llamada para inscribirse (o la que ya tiene); sin precio ni enlace", () => {
    const r = workshopReply(W, { upcomingLabel: null });
    expect(r).toBe(
      "Sí, el taller «Tu Sanacion con el Dinero» está abierto: es el domingo 15 de noviembre, 8:30 a. m. – 4:30 p. m., virtual (hora de Colombia). La inscripción es con una llamada con Dayana, donde te explica todo. ¿Quieres que te la separe?"
    );
    const booked = workshopReply(W, { upcomingLabel: "domingo, 25 de octubre, 1:00 p. m." });
    expect(booked).toContain("En tu llamada con Dayana (domingo, 25 de octubre, 1:00 p. m.) ella te explica todo y te inscribe.");
    for (const x of [r, booked]) expect(x).not.toMatch(/\$|cop|usd|https?:/i);
  });
  test("la respuesta del código con enlace de pago: abierto + cupo o llamada; con la llamada ya agendada, el enlace si lo quiere", () => {
    expect(workshopReply(WP, { upcomingLabel: null })).toBe(
      `Sí, el taller «Tu Sanacion con el Dinero» está abierto: es el domingo 15 de noviembre, 8:30 a. m. – 4:30 p. m., virtual (hora de Colombia). ${WORKSHOP_CHOICE}`
    );
    expect(workshopReply(WP, { upcomingLabel: "lunes, 26 de octubre, 9:00 a. m." })).toContain(
      "En tu llamada con Dayana (lunes, 26 de octubre, 9:00 a. m.) ella te explica todo. Si quieres separar tu cupo de una vez, dime y te envío el enlace de pago."
    );
    expect(workshopLinkReply(WP)).toBe(
      "Claro 🙏 Aquí tienes el enlace para separar tu cupo en el taller «Tu Sanacion con el Dinero». Ahí ves el valor y puedes pagar en línea; con el pago tu cupo queda separado."
    );
  });
  test("la línea del prompt: abierto, la llamada (también tras la llamada gratis o del webinar), sin valor ni el enlace de su proceso", () => {
    const l = workshopLine(W, { upcomingLabel: null });
    expect(l).toMatch(/^PREGUNTA POR EL TALLER: el taller «Tu Sanacion con el Dinero» es el domingo 15 de noviembre/);
    expect(l).toContain("offer_free_call_slots y book_free_call");
    expect(l).toContain("No le des el valor ni enlaces de pago");
    expect(workshopLine(W, { upcomingLabel: "lunes, 26 de octubre, 9:00 a. m." })).toContain("No le ofrezcas otra.");
  });
  test("la línea del prompt con enlace de pago: pregunta cupo o llamada, el enlace con la herramienta, sin el valor", () => {
    const l = workshopLine(WP, { upcomingLabel: null });
    expect(l).toContain("separar su cupo de una vez (le mandas el enlace de pago con send_workshop_link)");
    expect(l).toContain("Si ya dijo que quiere separar su cupo, pagar o pide el enlace, usa send_workshop_link de una vez");
    expect(l).toContain("offer_free_call_slots y book_free_call");
    expect(l).toContain("No digas el valor ni escribas enlaces");
    expect(l).not.toContain("No le des el valor ni enlaces de pago");
    expect(workshopLine(WP, { upcomingLabel: "lunes, 26 de octubre, 9:00 a. m." })).toContain("send_workshop_link");
  });
  test("withWorkshopCall: siempre «abierto» y la llamada para inscribirse, antes de la pregunta del final (evaluación 24-oct)", () => {
    const asked = "Natividad, el taller Tu Sanación con el Dinero es el domingo 15 de noviembre de 8:30 a. m. a 4:30 p. m. de forma virtual. ¿Desde qué país me escribes?";
    expect(withWorkshopStep(asked, W, { upcomingLabel: null })).toBe(
      "Natividad, el taller Tu Sanación con el Dinero es el domingo 15 de noviembre de 8:30 a. m. a 4:30 p. m. de forma virtual. Las inscripciones están abiertas y son con una llamada con Dayana, donde te explica todo. ¿Desde qué país me escribes?"
    );
    expect(withWorkshopStep("Las inscripciones están abiertas: es el domingo 15 de noviembre", W, { upcomingLabel: null })).toBe(
      "Las inscripciones están abiertas: es el domingo 15 de noviembre. La inscripción es con una llamada con Dayana, donde te explica todo. ¿Quieres que te la separe?"
    );
    expect(withWorkshopStep("El taller es el 15 de noviembre.", W, { upcomingLabel: null })).toBe(
      "El taller es el 15 de noviembre. Las inscripciones están abiertas y son con una llamada con Dayana, donde te explica todo. ¿Quieres que te la separe?"
    );
    const done = "Sí, está abierto y la inscripción es con una llamada con Dayana. ¿Quieres que te la separe?";
    expect(withWorkshopStep(done, W, { upcomingLabel: null })).toBe(done);
    // «Llamada» sin la inscripción no basta (revisión 24-oct).
    expect(withWorkshopStep("El taller está abierto. Si quieres, te agendo una llamada gratis.", W, { upcomingLabel: null })).toBe(
      "El taller está abierto. Si quieres, te agendo una llamada gratis. La inscripción es con una llamada con Dayana, donde te explica todo."
    );
    // «Separar tu cupo… llamada con Dayana» ya dice cómo inscribirse: no se repite.
    expect(withWorkshopStep("Para separar tu cupo agendamos una llamada corta con Dayana. ¿Desde qué país me escribes?", W, { upcomingLabel: null })).toBe(
      "Para separar tu cupo agendamos una llamada corta con Dayana. Las inscripciones están abiertas. ¿Desde qué país me escribes?"
    );
    expect(withWorkshopStep("El taller es el 15 de noviembre.", W, { upcomingLabel: "domingo, 25 de octubre, 1:00 p. m." })).toBe(
      "El taller es el 15 de noviembre. Las inscripciones están abiertas. En tu llamada con Dayana (domingo, 25 de octubre, 1:00 p. m.) ella te explica todo y te inscribe."
    );
  });

  test("«no hay ningún taller» cuando sí lo hay", () => {
    for (const t of [
      "Actualmente no tenemos ningún taller abierto programado para esa fecha",
      "Natividad, te bendigo. No hay ningún taller programado para el 15 de noviembre.",
      "Por ahora no hay talleres programados",
    ]) {
      expect([t, saysNoWorkshop(t)]).toEqual([t, true]);
    }
    expect(saysNoWorkshop("Sí, el taller está abierto")).toBe(false);
  });
});

describe("el cupo o la llamada (dueña, 25-oct: «que pregunte si para separar su cupo o agendar»)", () => {
  const now = new Date("2026-10-25T21:00:00Z").getTime();
  const at = (h: number) => new Date(now - h * 3600_000);
  const choice = `Sí, el taller «Tu Sanacion con el Dinero» está abierto. ${WORKSHOP_CHOICE}`;

  test("elige separar su cupo", () => {
    for (const t of [
      "Quiero separar mi cupo",
      "el cupo",
      "Separarlo de una vez",
      "Me pasas el link?",
      "¿Cómo pago?",
      "Quiero pagar el taller",
      "Mándame el enlace porfa",
      "Puedo pagar con tarjeta?",
    ]) {
      expect([t, wantsWorkshopSpot(t)]).toEqual([t, true]);
    }
    // Tras la pregunta, «la primera» es el cupo.
    for (const t of ["La primera", "1", "la 1", "Primero", "opción 1"]) expect([t, wantsWorkshopSpot(t, { afterChoice: true })]).toEqual([t, true]);
    expect(wantsWorkshopSpot("La primera", { afterChoice: false })).toBe(false);
  });
  test("no es elegir el cupo ahora: la llamada, después, no puede, ya pagó o pregunta por cuotas", () => {
    for (const t of [
      "Prefiero la llamada primero",
      "Mejor agendar con Dayana",
      "Quiero separar el cupo pero antes hablar con Dayana",
      "Después pago",
      "Pago la otra semana",
      "No puedo pagar ahora",
      "Todavía no, lo pienso",
      "Ya pagué",
      "Te mando el comprobante",
      "Se puede pagar en cuotas?",
      "¿Cuánto cuesta?",
      "Una pregunta",
      "Sí",
    ]) {
      expect([t, wantsWorkshopSpot(t, { afterChoice: true })]).toEqual([t, false]);
    }
  });
  test("isWorkshopChoice: la pregunta del cupo o la llamada (no la oferta de solo la llamada)", () => {
    expect(isWorkshopChoice(choice)).toBe(true);
    expect(isWorkshopChoice("La inscripción es con una llamada con Dayana. ¿Quieres que te la separe?")).toBe(false);
    expect(isWorkshopChoice("Te envío el enlace para separar tu cupo.")).toBe(false);
  });
  test("withWorkshopStep: sin la pregunta del cupo o la llamada, la pone en lugar de la suya; con el enlace ya pegado, no toca nada", () => {
    expect(
      withWorkshopStep("Natividad, el taller es el domingo 15 de noviembre, virtual. ¿Desde qué país me escribes?", WP, { upcomingLabel: null })
    ).toBe(`Natividad, el taller es el domingo 15 de noviembre, virtual. Las inscripciones están abiertas. ${WORKSHOP_CHOICE}`);
    expect(withWorkshopStep("Sí, el taller está abierto: es el 15 de noviembre.", WP, { upcomingLabel: null })).toBe(
      `Sí, el taller está abierto: es el 15 de noviembre. ${WORKSHOP_CHOICE}`
    );
    expect(withWorkshopStep(choice, WP, { upcomingLabel: null })).toBe(choice);
    // Ya pregunta por el cupo o la llamada sin «abierto»: solo eso, antes de la pregunta.
    expect(withWorkshopStep(`Es el 15 de noviembre. ${WORKSHOP_CHOICE}`, WP, { upcomingLabel: null })).toBe(
      `Es el 15 de noviembre. Las inscripciones están abiertas. ${WORKSHOP_CHOICE}`
    );
    const linked = "Claro, aquí tienes el enlace para separar tu cupo.";
    expect(withWorkshopStep(linked, WP, { upcomingLabel: null, linkSent: true })).toBe(linked);
  });
  test("promisesWorkshopLink: «aquí tienes el enlace», no la pregunta «¿te envío el enlace…?»", () => {
    expect(promisesWorkshopLink("Claro, aquí tienes el enlace para separar tu cupo.")).toBe(true);
    expect(promisesWorkshopLink("Te comparto el link de pago")).toBe(true);
    expect(promisesWorkshopLink(WORKSHOP_CHOICE)).toBe(false);
    expect(promisesWorkshopLink("¿Quieres que te envíe el enlace?")).toBe(false);
  });
  test("el enlace escrito a mano se quita (lo pega el código)", () => {
    expect(withoutWorkshopPayUrls(`Aquí tienes el enlace:\n${PAY}`)).toEqual({ text: "Aquí tienes el enlace:", had: true });
    expect(withoutWorkshopPayUrls("Aquí: dayanabeltran.com/pagar/p/taller-x. Ahí ves el valor.")).toEqual({ text: "Aquí: Ahí ves el valor.", had: true });
    expect(withoutWorkshopPayUrls("Sin enlace")).toEqual({ text: "Sin enlace", had: false });
  });
  test("la línea de lo que sigue: tras la pregunta, tras el enlace, o una oferta vieja de solo la llamada", () => {
    const asked = { direction: "INBOUND", body: "El costo del taller del 15 de noviembre?", sentAt: at(2) };
    const afterChoice = workshopFollowLine([asked, { direction: "OUTBOUND", body: choice, sentAt: at(1) }], WP, now);
    expect(afterChoice).toContain("le preguntamos si quiere separar su cupo de una vez");
    expect(afterChoice).toContain("send_workshop_link");
    // El país después de la pregunta sigue siendo la pregunta del cupo o la llamada.
    const country = workshopFollowLine(
      [asked, { direction: "OUTBOUND", body: choice, sentAt: at(1.5) }, { direction: "OUTBOUND", body: "¿Desde qué país me escribes?", sentAt: at(1) }],
      WP,
      now
    );
    expect(country).toContain("le preguntamos si quiere separar su cupo");
    const sent = [asked, { direction: "OUTBOUND", body: `${workshopLinkReply(WP)}\n\n${PAY}`, sentAt: at(1) }];
    expect(workshopLinkSent(sent, now)).toBe(true);
    expect(workshopFollowLine(sent, WP, now)).toContain("ya le mandaste el enlace de pago");
    const old = workshopFollowLine([asked, { direction: "OUTBOUND", body: "El taller está abierto. La inscripción es con una llamada con Dayana. ¿Quieres que te la separe?", sentAt: at(1) }], WP, now);
    expect(old).toContain("está separando su llamada con Dayana");
    expect(old).toContain("send_workshop_link");
    // Sin enlace de pago, como antes.
    expect(workshopFollowLine([asked], W, now)).toContain("No le des el valor ni enlaces de pago.");
  });
});
