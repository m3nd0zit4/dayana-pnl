import { describe, expect, test } from "bun:test";

import {
  isWorkshopAsk,
  isWorkshopOffer,
  saysNoWorkshop,
  titleWords,
  withWorkshopCall,
  workshopAskedRecently,
  workshopFlowActive,
  workshopFacts,
  workshopLeadActive,
  workshopLine,
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
  test("el mensaje: el taller, abierto, la llamada para inscribirse y las horas del código (o la pregunta)", () => {
    const list = "1. Lunes 27 de octubre, 3:00 p. m.\n\n¿Cuál te queda mejor? Puedes responderme con el número.";
    const withSlots = workshopOfferText(W, { firstName: "Naty", slotList: list });
    expect(withSlots.startsWith("Hola Naty 🙏 Sobre el taller «Tu Sanacion con el Dinero» por el que preguntaste: está abierto y es el domingo 15 de noviembre")).toBe(true);
    expect(withSlots).toContain("La inscripción es con una llamada con Dayana");
    expect(withSlots.endsWith(list)).toBe(true);
    expect(withSlots).not.toMatch(/\$|USD|COP|https?:/);
    const noSlots = workshopOfferText(W, { firstName: null, slotList: null });
    expect(noSlots.startsWith("Hola 🙏 Sobre")).toBe(true);
    expect(noSlots.endsWith("¿Quieres que te la separe?")).toBe(true);
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
  test("la línea del prompt: abierto, la llamada (también tras la llamada gratis o del webinar), sin valor ni el enlace de su proceso", () => {
    const l = workshopLine(W, { upcomingLabel: null });
    expect(l).toMatch(/^PREGUNTA POR EL TALLER: el taller «Tu Sanacion con el Dinero» es el domingo 15 de noviembre/);
    expect(l).toContain("offer_free_call_slots y book_free_call");
    expect(l).toContain("No le des el valor ni enlaces de pago");
    expect(workshopLine(W, { upcomingLabel: "lunes, 26 de octubre, 9:00 a. m." })).toContain("No le ofrezcas otra.");
  });
  test("withWorkshopCall: siempre «abierto» y la llamada para inscribirse, antes de la pregunta del final (evaluación 24-oct)", () => {
    const asked = "Natividad, el taller Tu Sanación con el Dinero es el domingo 15 de noviembre de 8:30 a. m. a 4:30 p. m. de forma virtual. ¿Desde qué país me escribes?";
    expect(withWorkshopCall(asked, { upcomingLabel: null })).toBe(
      "Natividad, el taller Tu Sanación con el Dinero es el domingo 15 de noviembre de 8:30 a. m. a 4:30 p. m. de forma virtual. Las inscripciones están abiertas y son con una llamada con Dayana, donde te explica todo. ¿Desde qué país me escribes?"
    );
    expect(withWorkshopCall("Las inscripciones están abiertas: es el domingo 15 de noviembre", { upcomingLabel: null })).toBe(
      "Las inscripciones están abiertas: es el domingo 15 de noviembre. La inscripción es con una llamada con Dayana, donde te explica todo. ¿Quieres que te la separe?"
    );
    expect(withWorkshopCall("El taller es el 15 de noviembre.", { upcomingLabel: null })).toBe(
      "El taller es el 15 de noviembre. Las inscripciones están abiertas y son con una llamada con Dayana, donde te explica todo. ¿Quieres que te la separe?"
    );
    const done = "Sí, está abierto y la inscripción es con una llamada con Dayana. ¿Quieres que te la separe?";
    expect(withWorkshopCall(done, { upcomingLabel: null })).toBe(done);
    // «Llamada» sin la inscripción no basta (revisión 24-oct).
    expect(withWorkshopCall("El taller está abierto. Si quieres, te agendo una llamada gratis.", { upcomingLabel: null })).toBe(
      "El taller está abierto. Si quieres, te agendo una llamada gratis. La inscripción es con una llamada con Dayana, donde te explica todo."
    );
    // «Separar tu cupo… llamada con Dayana» ya dice cómo inscribirse: no se repite.
    expect(withWorkshopCall("Para separar tu cupo agendamos una llamada corta con Dayana. ¿Desde qué país me escribes?", { upcomingLabel: null })).toBe(
      "Para separar tu cupo agendamos una llamada corta con Dayana. Las inscripciones están abiertas. ¿Desde qué país me escribes?"
    );
    expect(withWorkshopCall("El taller es el 15 de noviembre.", { upcomingLabel: "domingo, 25 de octubre, 1:00 p. m." })).toBe(
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
