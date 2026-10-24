import { describe, expect, test } from "bun:test";

import {
  isWorkshopAsk,
  saysNoWorkshop,
  titleWords,
  withWorkshopCall,
  workshopAskedRecently,
  workshopFacts,
  workshopLine,
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
