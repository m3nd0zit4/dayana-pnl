import { describe, expect, test } from "bun:test";

import { dualZoneLabel } from "./free-call-rules";
import { promiseBreach } from "./promise-guard";
import { getTimeLabelInTz } from "@/lib/datetime/zoned-time";

import { bookedLabelsFor, bookedMessage, offerList, offerMessage, replyToOffer, resolveChoice, withoutSlotLines, type OfferedSlot } from "./slot-choice";

const BOG = "America/Bogota";
const MEX = "America/Mexico_City";
const MAD = "Europe/Madrid";

// Natalia, 21-oct (miércoles): hoy 12:15, 12:30 y 12:45 p. m. (Perú = Colombia).
const natalia: OfferedSlot[] = [
  { startIso: "2026-10-21T17:15:00.000Z", label: "miércoles, 21 de octubre, 12:15 p. m." },
  { startIso: "2026-10-21T17:30:00.000Z", label: "miércoles, 21 de octubre, 12:30 p. m." },
  { startIso: "2026-10-21T17:45:00.000Z", label: "miércoles, 21 de octubre, 12:45 p. m." },
];
const nataliaNow = new Date("2026-10-21T16:24:00.000Z");
const peru = { personTz: "America/Lima", dayanaTz: BOG, now: nataliaNow };

// Jueves 29 3:00 p. m., viernes 30 9:00 a. m. y 3:00 p. m. (Colombia); hoy es el miércoles 28.
const week: OfferedSlot[] = [
  { startIso: "2026-10-29T20:00:00.000Z", label: "jueves, 29 de octubre, 3:00 p. m." },
  { startIso: "2026-10-30T14:00:00.000Z", label: "viernes, 30 de octubre, 9:00 a. m." },
  { startIso: "2026-10-30T20:00:00.000Z", label: "viernes, 30 de octubre, 3:00 p. m." },
];
const col = { personTz: BOG, dayanaTz: BOG, now: new Date("2026-10-28T15:00:00.000Z") };

const one = (r: ReturnType<typeof resolveChoice>) => (r.kind === "one" ? r.option.startIso : r.kind);

describe("resolveChoice: lo que la persona eligió de la última lista", () => {
  test("Natalia: «Ya hoy a las 12:45 pm» es la tercera", () => {
    expect(one(resolveChoice("Ya hoy a las 12:45 pm", natalia, peru))).toBe("2026-10-21T17:45:00.000Z");
  });
  test("el número o el ordinal", () => {
    expect(one(resolveChoice("2", week, col))).toBe(week[1].startIso);
    expect(one(resolveChoice("La 3", week, col))).toBe(week[2].startIso);
    expect(one(resolveChoice("opción 1 por favor", week, col))).toBe(week[0].startIso);
    expect(one(resolveChoice("la primera", week, col))).toBe(week[0].startIso);
    expect(one(resolveChoice("La última 🙏", week, col))).toBe(week[2].startIso);
    expect(one(resolveChoice("Sí, la segunda", week, col))).toBe(week[1].startIso);
  });
  test("un número fuera de la lista no es nada", () => {
    expect(resolveChoice("5", week, col).kind).toBe("none");
  });
  test("día + hora, día solo o hora sola si es única", () => {
    expect(one(resolveChoice("el viernes a las 3", week, col))).toBe(week[2].startIso);
    expect(one(resolveChoice("jueves", week, col))).toBe(week[0].startIso);
    expect(one(resolveChoice("a las 9 am", week, col))).toBe(week[1].startIso);
    expect(one(resolveChoice("El 29 de octubre", week, col))).toBe(week[0].startIso);
  });
  test("varias posibles: se pregunta (many), no se adivina", () => {
    const r = resolveChoice("el viernes", week, col);
    expect(r.kind).toBe("many");
    if (r.kind === "many") expect(r.options.map((o) => o.startIso)).toEqual([week[1].startIso, week[2].startIso]);
    expect(resolveChoice("a las 3", week, col).kind).toBe("many");
  });
  test("«mañana» es el día, «de la mañana» la franja", () => {
    // Hoy es miércoles 28: mañana = jueves 29.
    expect(one(resolveChoice("mañana", week, col))).toBe(week[0].startIso);
    expect(one(resolveChoice("a las 9 de la mañana", week, col))).toBe(week[1].startIso);
  });
  test("en su hora o en la de Colombia (México: una hora menos en octubre)", () => {
    const mx = { personTz: MEX, dayanaTz: BOG, now: col.now };
    expect(one(resolveChoice("el jueves a las 2", week, mx))).toBe(week[0].startIso);
    expect(one(resolveChoice("el jueves a las 3 hora Colombia", week, mx))).toBe(week[0].startIso);
  });
  test("cruzando la medianoche: el día en su zona", () => {
    // 9:00 p. m. del jueves en Colombia = 3:00 a. m. del viernes en Madrid; la otra, 3:00 p. m. del viernes.
    const late: OfferedSlot[] = [{ startIso: "2026-10-30T02:00:00.000Z", label: "x" }, { startIso: "2026-10-30T14:00:00.000Z", label: "y" }];
    const es = { personTz: MAD, dayanaTz: BOG, now: col.now };
    expect(one(resolveChoice("el viernes a las 3 am", late, es))).toBe(late[0].startIso);
  });
  test("no elige: preguntas, «no puedo», otro día, otra cosa, mensajes largos", () => {
    for (const t of [
      "¿la de las 3 es hora de Colombia?",
      "el jueves no puedo",
      "ninguna me sirve",
      "¿tienes otro día?",
      "el jueves tengo cita médica a las 3",
      "mejor otra hora",
      "Sii está bien",
      "ok",
      "Gracias",
      "jueves a las 3 está bien pero antes quería preguntarte si la llamada tiene algún costo porque no tengo dinero ahora mismo",
    ]) {
      expect([t, resolveChoice(t, week, col).kind]).toEqual([t, "none"]);
    }
  });
  test("número y hora que no cuadran: nada", () => {
    expect(resolveChoice("la 1 a las 9", week, col).kind).toBe("none");
  });
  test("sin lista: nada", () => {
    expect(resolveChoice("la primera", [], col).kind).toBe("none");
  });
});

describe("los mensajes del código pasan el freno de promesas", () => {
  // Como arma run.ts el respaldo: las horas de la reserva por zona y `bookedLabelsFor`.
  const backingFor = (iso: string, zones: string[]) => {
    const d = new Date(iso);
    return {
      backing: zones.map((z) => getTimeLabelInTz(d, z)),
      bookedLabels: bookedLabelsFor([d], zones, BOG),
      hasBooking: true,
      bookingToday: false,
    };
  };
  test("agendada, en Colombia, en México y cruzando la medianoche (Madrid)", () => {
    const cases: [string, string, string][] = [
      ["2026-10-29T20:00:00.000Z", BOG, BOG],
      ["2026-10-29T20:00:00.000Z", MEX, BOG],
      ["2026-10-30T02:00:00.000Z", MAD, BOG],
    ];
    for (const [iso, person, dayana] of cases) {
      const label = dualZoneLabel(iso, person, dayana);
      for (const kind of ["booked", "moved"] as const) {
        const text = bookedMessage(kind, label, "Natalia");
        expect([text, promiseBreach({ text, ...backingFor(iso, [...new Set([person, dayana])]) })]).toEqual([text, null]);
      }
    }
  });
  test("la lista de horas ofrecidas en esta vuelta", () => {
    const options = week.map((o) => ({ ...o, label: dualZoneLabel(o.startIso, MEX, BOG) }));
    const text = offerMessage("Con gusto.", options, true);
    expect(promiseBreach({ text, backing: options.map((o) => o.label), bookedLabels: [], hasBooking: false, bookingToday: false })).toBeNull();
  });
});

describe("offerMessage, bookedMessage", () => {
  test("la frase del modelo sin horas, y la lista debajo", () => {
    expect(offerMessage("Maravilloso, Natalia. Tengo hoy a las 12:15 p. m. ¿Cuál te sirve?", natalia.slice(0, 1), true)).toBe(
      "Maravilloso, Natalia.\n\n1. miércoles, 21 de octubre, 12:15 p. m.\n\n¿Cuál te queda mejor? Puedes responderme con el número."
    );
    expect(offerMessage("¿Cuál te sirve? 12:15 p. m.", natalia.slice(0, 1), false).startsWith("En lo que me dijiste no hay espacio")).toBe(true);
  });
  test("la confirmación", () => {
    expect(bookedMessage("booked", "miércoles, 21 de octubre, 12:45 p. m.", "Natalia")).toBe(
      "Listo, Natalia. Tu llamada gratis con Dayana quedó para el miércoles, 21 de octubre, 12:45 p. m. Dayana te llama por WhatsApp a este número."
    );
    expect(bookedMessage("moved", "jueves, 29 de octubre, 3:00 p. m.", null)).toBe(
      "Listo. Tu llamada gratis con Dayana pasó al jueves, 29 de octubre, 3:00 p. m. Dayana te llama por WhatsApp a este número."
    );
  });
});

describe("replyToOffer: la persona le contesta a la lista", () => {
  const at = new Date("2026-10-21T16:23:51.000Z");
  const offer = { at, options: natalia };
  const list = offerMessage("Maravilloso, Natalia.", natalia, true);
  const out = (body: string, sentAt: Date, extra = {}) => ({ direction: "OUTBOUND", body, sentAt, ...extra });
  const inb = (body: string, sentAt: Date, extra = {}) => ({ direction: "INBOUND", body, sentAt, ...extra });
  const t = (s: number) => new Date(at.getTime() + s * 1000);
  test("Natalia: «Ya hoy a las 12:45 pm» + «Sii está bien» justo después de la lista", () => {
    expect(replyToOffer([inb("Sii está bien", t(45)), inb("Ya hoy a las 12:45 pm", t(39)), out(list, t(12))], offer)).toBe(
      "Ya hoy a las 12:45 pm Sii está bien"
    );
  });
  test("lo último no fue la lista (la conversación siguió): no", () => {
    expect(replyToOffer([inb("el jueves", t(300)), out("Claro, la llamada dura 15 minutos.", t(200)), inb("¿cuánto dura?", t(100)), out(list, t(12))], offer)).toBeNull();
  });
  test("la lista es de antes de esa oferta, o no trae sus horas: no", () => {
    expect(replyToOffer([inb("la 2", t(50)), out(list, t(-60))], offer)).toBeNull();
    expect(replyToOffer([inb("la 2", t(50)), out("¿Qué día te queda bien?", t(12))], offer)).toBeNull();
  });
  test("la confirmación trae la hora agendada pero no es la lista: «la 2» después no mueve nada (e2e 21-oct)", () => {
    const confirmed = bookedMessage("booked", natalia[2].label, "Natalia");
    expect(replyToOffer([inb("la 2", t(80)), out(confirmed, t(60)), inb("Sii", t(50)), out(list, t(12))], offer)).toBeNull();
  });
  test("con foto, o muchos mensajes: no", () => {
    expect(replyToOffer([inb("la 2", t(50), { attachments: [{ kind: "image" }] }), out(list, t(12))], offer)).toBeNull();
    expect(replyToOffer([inb("a", t(54)), inb("b", t(53)), inb("c", t(52)), inb("la 2", t(51)), out(list, t(12))], offer)).toBeNull();
  });
  test("un aviso del sistema o un envío fallido en medio no cuenta", () => {
    expect(replyToOffer([inb("la 2", t(50)), out("x", t(40), { kind: "system" }), out("y", t(30), { status: "FAILED" }), out(list, t(12))], offer)).toBe("la 2");
  });
});

describe("offerList y withoutSlotLines", () => {
  test("la lista numerada que pega el código", () => {
    expect(offerList(week.slice(0, 2))).toBe(
      "1. jueves, 29 de octubre, 3:00 p. m.\n2. viernes, 30 de octubre, 9:00 a. m.\n\n¿Cuál te queda mejor? Puedes responderme con el número."
    );
  });
  test("del texto del modelo se quitan las horas y la pregunta (las pone el código)", () => {
    expect(
      withoutSlotLines(
        "Maravilloso, Natalia. Tengo disponibilidad hoy, miércoles 21 de octubre, a las 12:15 p. m., a las 12:30 p. m. o a las 12:45 p. m. de tu hora. ¿Cuál de estos horarios te queda mejor?"
      )
    ).toBe("Maravilloso, Natalia.");
    expect(withoutSlotLines("Claro.\n• jueves 23, 3:00 p. m.\n• viernes 24, 9:00 a. m.\n¿Te sirve alguna?")).toBe("Claro.");
    expect(withoutSlotLines("En la tarde que pediste no hay espacio, pero estas horas sí.")).toBe(
      "En la tarde que pediste no hay espacio, pero estas horas sí."
    );
  });
});
