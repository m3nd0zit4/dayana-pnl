import { describe, expect, test } from "bun:test";

import { callWindowReply, decideWaiting, waitingMessage } from "./waiting-room-rules";

const start = new Date("2026-10-20T15:00:00Z");
const min = (m: number) => new Date(start.getTime() + m * 60_000);
const free = { startsAt: start, endsAt: min(15), sessionsLabel: "0/0" };
const base = { appointment: free, busy: [], lastDayanaAt: null, notices: { count: 0, lastAt: null } };

describe("decideWaiting", () => {
  test("escribe a su hora y Dayana sigue en la reunión anterior: que espere 5 minutos", () => {
    const d = decideWaiting({ ...base, now: min(2), busy: [{ start: min(-60), end: min(10) }] });
    expect(d.kind).toBe("busy");
  });

  test("la reunión anterior acaba de terminar (hace 3 min): todavía está terminando", () => {
    expect(decideWaiting({ ...base, now: min(1), busy: [{ start: min(-60), end: min(-2) }] }).kind).toBe("busy");
  });

  test("no hay nada en el calendario y ya es la hora: se le avisa a Dayana", () => {
    expect(decideWaiting({ ...base, now: min(1) }).kind).toBe("not_started");
  });

  test("Fernanda (19-oct): la llamada ya se marcó «No contestó» y se le mandaron horas: nada, la IA contesta (agenda)", () => {
    const decided = { ...free, callOutcome: "no_answer", rescheduleSentAt: min(19) };
    const d = decideWaiting({ ...base, appointment: decided, now: min(25) });
    expect(d).toEqual({ kind: "none", reason: "la llamada ya se decidió" });
    expect(decideWaiting({ ...base, appointment: { ...free, callOutcome: "answered" }, now: min(5) }).kind).toBe("none");
  });

  test("Dayana ya le escribió: está con ella, nada", () => {
    expect(decideWaiting({ ...base, now: min(2), busy: [{ start: min(-60), end: min(10) }], lastDayanaAt: min(-1) }).kind).toBe("none");
  });

  test("una sesión pagada (1 h) no recibe estos avisos", () => {
    const paid = { startsAt: start, endsAt: min(60), sessionsLabel: "3/6" };
    expect(decideWaiting({ ...base, appointment: paid, now: min(2), busy: [{ start: min(-60), end: min(10) }] }).kind).toBe("none");
  });

  test("fuera de la hora de la cita, nada", () => {
    expect(decideWaiting({ ...base, now: min(-60) }).kind).toBe("none");
    expect(decideWaiting({ ...base, now: min(45) }).kind).toBe("none");
  });

  test("como mucho dos avisos, con 5 minutos entre uno y otro", () => {
    expect(decideWaiting({ ...base, now: min(2), notices: { count: 1, lastAt: min(0) } }).kind).toBe("none");
    expect(decideWaiting({ ...base, now: min(8), notices: { count: 1, lastAt: min(0) } }).kind).toBe("not_started");
    expect(decideWaiting({ ...base, now: min(20), notices: { count: 2, lastAt: min(8) } }).kind).toBe("none");
  });

  test("su propia cita en el calendario no cuenta como «ocupada»", () => {
    expect(decideWaiting({ ...base, now: min(1), busy: [{ start, end: min(15) }] }).kind).toBe("not_started");
  });

  test("el mensaje habla como asistente", () => {
    expect(waitingMessage("busy", "Lucía Pérez")).toBe(
      "Hola Lucía 🙏 Dayana está terminando una reunión. Por favor espérala unos 5 minutos y te llama por aquí."
    );
    expect(waitingMessage("not_started", null)).toContain("ya le aviso a Dayana");
  });
});

describe("callWindowReply: lo que escribe a la hora de su llamada (Xime, 22-oct)", () => {
  const kind = (text: string, offeredHours = false) => callWindowReply({ text, offeredHours, todayWeekdays: ["jueves"] });
  test("habla de otra hora: se atiende ya", () => {
    // Su «sí» a la hora que le propuso la asistente, y lo que había pedido antes.
    expect(kind("si mañana esta perfecto a esa hora", true)).toBe("move");
    expect(
      kind("Hola hola oye fíjate qué pasó algo imprevisto y el tema es que no voy a estar en un lugar tranquilo ni quería ver si podíamos reagendar")
    ).toBe("move");
    expect(kind("¿Podemos cambiar la llamada para el viernes?")).toBe("move");
    expect(kind("No voy a poder, se me complicó")).toBe("move");
    expect(kind("Mejor a las 4:00 p. m.")).toBe("move");
    expect(kind("el sábado 24 de octubre")).toBe("move");
  });
  test("elige o dice que sí a las horas que le acabamos de ofrecer", () => {
    expect(kind("la 2", true)).toBe("move");
    expect(kind("Sí", true)).toBe("move");
    expect(kind("la primera", true)).toBe("move");
  });
  test("es de la llamada de ahora: como siempre", () => {
    for (const t of ["Hola, ya estoy lista para la llamada", "¿Sigues ahí?", "¿Me va a llamar?", "Hola, ya estoy", "Buenos días", "ok", "Gracias 🙏", "👍", "No me han llamado", "Estoy en el trabajo, salgo en 10 minutos", "Sí", "hoy jueves ya estoy"]) {
      expect([t, kind(t)]).toEqual([t, "now"]);
    }
  });
  test("«de la mañana» no es «mañana»", () => {
    expect(kind("la llamada era a las 10 de la mañana ¿verdad?")).toBe("now");
  });
  test("otra cosa: después de su hora", () => {
    expect(kind("¿Cuánto cuesta la terapia?")).toBe("later");
    expect(kind("Quería contarte que he estado muy ansiosa estos días")).toBe("later");
  });
});
