import { describe, expect, test } from "bun:test";

import { agreedProposal, burstAndAsk, offeredHoursBefore, proposedStart, saysYesToTime, type AgreedLine } from "./agreed-time";
import { dualZoneLabel } from "./free-call-rules";
import { promiseBreach } from "./promise-guard";
import { agreedTakenMessage } from "./slot-choice";

const MEX = "America/Mexico_City";
const BOG = "America/Bogota";
const zones = { personTz: MEX, dayanaTz: BOG };

// Xime (producción, 22-oct; jueves). Hora UTC de cada mensaje.
const at = (iso: string) => new Date(iso);
const XIME_ASK = "Entiendo perfecto, no hay problema. Mañana viernes a las 8:00 a. m. de tu hora (9:00 a. m. de Colombia), ¿te queda bien?";
const FRIDAY_8_MX = "2026-10-23T14:00:00.000Z";
const person = (body: string, iso: string): AgreedLine => ({ direction: "INBOUND", body, sentAt: at(iso), kind: "message", status: "RECEIVED" });
const ai = (body: string, iso: string): AgreedLine => ({ direction: "OUTBOUND", body, sentAt: at(iso), kind: "message", status: "DELIVERED", isAutoReply: true, source: null });
const dayana = (body: string | null, iso: string): AgreedLine => ({ direction: "OUTBOUND", body, sentAt: at(iso), kind: "message", status: "DELIVERED", isAutoReply: false, source: null });
const reminder = (body: string, iso: string): AgreedLine => ({ ...ai(body, iso), source: "recordatorio:1h:evt" });

/** El chat de Xime alrededor de su llamada (10:15 a. m. de su hora, 16:15 UTC), del más nuevo al más viejo. */
const ximeChat = (yes = "si mañana esta perfecto a esa hora"): AgreedLine[] =>
  [
    reminder("Hola 😊, te recuerdo que hoy a las 10:15 a. m. Dayana te llamará por WhatsApp a este número para tu llamada.", "2026-10-22T15:25:04Z"),
    person(
      "Hola hola oye fíjate qué pasó algo imprevisto y el tema es que no voy a estar en un lugar tranquilo ni quería ver si podíamos reagendar porque tiene súper mega interesa igual mañana no sé o qué día tenga libre",
      "2026-10-22T15:55:34Z"
    ),
    ai(XIME_ASK, "2026-10-22T15:55:47Z"),
    dayana("🎤 Hola, mi hermosa, te bendigo, te habla Dayana Beltrán, okay, mi bella, no hay problema, quedamos atentos para reagendar, hacemos esta llamadita en lo que te pueda servir, ¿okay? Bendiciones.", "2026-10-22T16:17:47Z"),
    dayana(null, "2026-10-22T16:17:51Z"),
    person(yes, "2026-10-22T16:18:57Z"),
  ].reverse();

describe("proposedStart: la hora que propone la asistente", () => {
  test("Xime: «Mañana viernes a las 8:00 a. m. de tu hora (9:00 a. m. de Colombia), ¿te queda bien?» = viernes 14:00 UTC", () => {
    expect(proposedStart(XIME_ASK, at("2026-10-22T15:55:47Z"), zones)).toBe(FRIDAY_8_MX);
  });
  test("con la fecha y en la misma zona (Colombia)", () => {
    expect(proposedStart("¿Te sirve el jueves 29 de octubre a las 3:00 p. m.?", at("2026-10-27T15:00:00Z"), { personTz: BOG, dayanaTz: BOG })).toBe(
      "2026-10-29T20:00:00.000Z"
    );
  });
  test("una fecha lejana con su día de la semana (no el próximo de ese nombre)", () => {
    expect(
      proposedStart("¿Te queda bien el lunes 14 de diciembre a las 8:00 a. m. de tu hora (9:00 a. m. de Colombia)?", at("2026-10-29T03:00:00Z"), zones)
    ).toBe("2026-12-14T14:00:00.000Z");
    // El día de la semana no cuadra con la fecha: no se adivina.
    expect(proposedStart("¿Te queda bien el martes 14 de diciembre a las 8:00 a. m. de tu hora (9:00 a. m. de Colombia)?", at("2026-10-29T03:00:00Z"), zones)).toBeNull();
  });
  test("una sola hora en otra zona: solo si dice de cuál", () => {
    const sent = at("2026-10-22T15:55:47Z");
    expect(proposedStart("¿Te sirve mañana a las 9:00 a. m. hora de Colombia?", sent, zones)).toBe(FRIDAY_8_MX);
    expect(proposedStart("¿Te sirve mañana a las 8:00 a. m. (tu hora)?", sent, zones)).toBe(FRIDAY_8_MX);
    expect(proposedStart("¿Te sirve mañana a las 8:00 a. m.?", sent, zones)).toBeNull();
  });
  test("cerca de la medianoche: el día es el suyo y la hora de Colombia cae al día siguiente", () => {
    // Jueves 22, 11:30 p. m. en México (viernes 00:30 en Bogotá): «mañana viernes 11:30 p. m. de tu hora (12:30 a. m. de Colombia)».
    expect(
      proposedStart("¿Te sirve mañana viernes a las 11:30 p. m. de tu hora (12:30 a. m. de Colombia)?", at("2026-10-23T05:30:00Z"), zones)
    ).toBe("2026-10-24T05:30:00.000Z");
  });
  test("la pregunta puede ir en la frase siguiente", () => {
    expect(proposedStart("Mañana viernes hay espacio a las 8:00 a. m. de tu hora (9:00 a. m. de Colombia). ¿Te queda bien?", at("2026-10-22T15:55:47Z"), zones)).toBe(
      FRIDAY_8_MX
    );
  });
  test("no propone nada: una confirmación, una lista, dos horas, sin día, sin a. m./p. m., días que no cuadran", () => {
    const sent = at("2026-10-22T15:55:47Z");
    expect(proposedStart("Tu llamada con Dayana queda para mañana viernes a las 8:00 a. m. de tu hora.", sent, zones)).toBeNull();
    expect(proposedStart("Estas son las horas:\n1. viernes, 23 de octubre, 8:00 a. m.\n2. viernes, 23 de octubre, 9:00 a. m.\n¿Cuál te queda mejor?", sent, zones)).toBeNull();
    expect(proposedStart("¿Te sirve mañana a las 8:00 a. m. o a las 3:00 p. m. de tu hora?", sent, zones)).toBeNull();
    expect(proposedStart("¿Te sirve a las 8:00 a. m. de tu hora (9:00 a. m. de Colombia)?", sent, zones)).toBeNull();
    expect(proposedStart("¿Te sirve mañana a las 8 de tu hora?", sent, { personTz: BOG, dayanaTz: BOG })).toBeNull();
    expect(proposedStart("¿Te sirve mañana sábado a las 8:00 a. m. de tu hora (9:00 a. m. de Colombia)?", sent, zones)).toBeNull();
    // Las dos horas no son el mismo instante («8:00 de tu hora (8:00 de Colombia)»).
    expect(proposedStart("¿Mañana a las 8:00 a. m. de tu hora (10:00 a. m. de Colombia), te sirve?", sent, zones)).toBeNull();
  });
});

describe("saysYesToTime", () => {
  test("acepta", () => {
    for (const t of ["si mañana esta perfecto a esa hora", "Sí", "Siii perfecto", "Ok, a esa hora está bien", "Dale, me sirve", "Perfecto, agéndame por favor"]) {
      expect([t, saysYesToTime(t)]).toEqual([t, true]);
    }
  });
  test("no acepta: preguntas, peros, otra hora, «te confirmo», un no", () => {
    for (const t of ["¿A qué hora de Colombia?", "Sí pero mejor a las 9", "No, mañana no puedo", "Sí, mañana te confirmo", "Déjame ver y te aviso", "Otra hora porfa", "Ahí vemos"]) {
      expect([t, saysYesToTime(t)]).toEqual([t, false]);
    }
  });
});

describe("agreedProposal: aceptó la hora que le propuso la asistente", () => {
  test("Xime: el «sí» pasa por encima del audio de Dayana y da el viernes 8:00 a. m. de su hora", () => {
    const r = agreedProposal(ximeChat(), { ...zones, now: at("2026-10-22T16:21:03Z"), maxAgeMs: 12 * 3600_000 });
    expect(r).toEqual({
      startIso: FRIDAY_8_MX,
      said: "si mañana esta perfecto a esa hora",
      saidAt: at("2026-10-22T16:18:57Z"),
      proposedAt: at("2026-10-22T15:55:47Z"),
    });
  });
  test("si nombra otro día, no es esa hora", () => {
    expect(agreedProposal(ximeChat("si el sábado esta perfecto"), zones)).toBeNull();
  });
  test("no es un sí", () => {
    expect(agreedProposal(ximeChat("mejor el lunes"), zones)).toBeNull();
    expect(agreedProposal(ximeChat("¿y a qué hora de Colombia sería?"), zones)).toBeNull();
  });
  test("muy viejo: más de 12 h desde su sí", () => {
    expect(agreedProposal(ximeChat(), { ...zones, now: at("2026-10-23T05:00:00Z"), maxAgeMs: 12 * 3600_000 })).toBeNull();
  });
  test("un recordatorio o horas de Dayana entre la propuesta y su sí cortan", () => {
    const chat = ximeChat();
    const withReminder = [chat[0], reminder("Te recuerdo tu llamada de hoy a las 10:15 a. m.", "2026-10-22T16:10:00Z"), ...chat.slice(1)];
    expect(agreedProposal(withReminder, zones)).toBeNull();
    const withDayanaHours = [chat[0], dayana("Mejor el viernes a las 11:00 a. m.", "2026-10-22T16:18:00Z"), ...chat.slice(1)];
    expect(agreedProposal(withDayanaHours, zones)).toBeNull();
  });
  test("lo último es nuestro: nada que leer", () => {
    expect(agreedProposal([ai("Listo.", "2026-10-22T16:20:00Z"), ...ximeChat()], zones)).toBeNull();
  });
  test("con foto no es elegir", () => {
    const chat = ximeChat();
    expect(agreedProposal([{ ...chat[0], attachments: [{ kind: "image" }] }, ...chat.slice(1)], zones)).toBeNull();
  });
});

describe("burstAndAsk / offeredHoursBefore", () => {
  test("Xime: lo de antes de su sí es la propuesta (con hora y pregunta)", () => {
    const { burst, ask } = burstAndAsk(ximeChat());
    expect(burst.map((b) => b.body)).toEqual(["si mañana esta perfecto a esa hora"]);
    expect(ask?.body).toBe(XIME_ASK);
    expect(offeredHoursBefore(ximeChat(), at("2026-10-22T16:19:00Z"))).toBe(true);
  });
  test("después del recordatorio de 1 h no hay horas ofrecidas (un «ok» es de la llamada de ahora)", () => {
    const chat: AgreedLine[] = [person("ok", "2026-10-22T16:16:00Z"), reminder("Hola, hoy a las 10:15 a. m. Dayana te llama.", "2026-10-22T15:25:00Z"), ai(XIME_ASK, "2026-10-22T15:20:00Z")];
    expect(offeredHoursBefore(chat, at("2026-10-22T16:16:30Z"))).toBe(false);
  });
});

describe("agreedTakenMessage (la hora que aceptó ya no está libre)", () => {
  test("dice cuál, trae las más cercanas numeradas y pasa el freno de promesas con su respaldo", () => {
    const options = ["2026-10-23T14:45:00.000Z", "2026-10-23T15:15:00.000Z", "2026-10-23T16:40:00.000Z"].map((startIso) => ({
      startIso,
      label: dualZoneLabel(startIso, MEX, BOG),
    }));
    const label = dualZoneLabel(FRIDAY_8_MX, MEX, BOG);
    const text = agreedTakenMessage(label, options);
    expect(text.startsWith(`Perdona, el ${label} ya no está libre`)).toBe(true);
    expect(text).toContain(`1. ${options[0].label}`);
    expect(text).toContain("¿Cuál te queda mejor?");
    // Como lo arma run.ts: las opciones y la hora acordada (salen en el rastro de la vuelta).
    expect(promiseBreach({ text, backing: [label, ...options.map((o) => o.label)], bookedLabels: [], hasBooking: false, bookingToday: false })).toBeNull();
  });
});
