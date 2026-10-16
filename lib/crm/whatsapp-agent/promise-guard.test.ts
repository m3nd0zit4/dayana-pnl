import { describe, expect, test } from "bun:test";

import { promiseBreach, timesIn } from "./promise-guard";

const none = { backing: [], hasBooking: false, bookingToday: false };
const OFFERED = [
  "viernes, 16 de octubre, 8:45 p. m. (tu hora) · 9:45 p. m. en Colombia",
  "lunes, 19 de octubre, 8:15 a. m. (tu hora) · 9:15 a. m. en Colombia",
  "miércoles, 21 de octubre, 7:00 a. m. (tu hora) · 8:00 a. m. en Colombia",
];

describe("timesIn", () => {
  test("a. m./p. m. en sus formas y «de la mañana/tarde»", () => {
    expect(timesIn("a las 10:00 a.m. o a las 4:00 p.m.")).toEqual(["10:00a", "4:00p"]);
    expect(timesIn("8:45 p. m. · 9 a. m. · 7 pm")).toEqual(["8:45p", "9:00a", "7:00p"]);
    expect(timesIn("el sábado a las 10 de la mañana o 3 de la tarde")).toEqual(["10:00a", "3:00p"]);
    expect(timesIn("sin horas, 15 minutos, 2026")).toEqual([]);
  });
});

describe("lo que pasó el 16-oct (no sale)", () => {
  test("«💙💙💜🩷»: horas inventadas sin que la agenda respondiera", () => {
    const text =
      "Te comparto las opciones de horario para tu llamada gratis de 15 minutos con Dayana: sábado 17 de octubre a las 10:00 a.m. o a las 4:00 p.m. hora de la CDMX (que son las 10:00 a.m. y las 4:00 p.m. hora de Colombia). ¿Cuál te queda mejor?";
    expect(promiseBreach({ ...none, text })?.breach).toBe("invented_slots");
    // Tampoco valen si la agenda ofreció otras.
    expect(promiseBreach({ ...none, backing: OFFERED, text })?.breach).toBe("invented_slots");
  });

  test("«💙💙💜🩷»: «queda confirmada» sin cita", () => {
    const text = "Sí, queda confirmada para este sábado 17 de octubre a las 10:00 a.m. hora de la CDMX. Dayana te llama por WhatsApp a este número.";
    expect(promiseBreach({ ...none, text })?.breach).toBe("false_booking");
  });

  test("Valentina: «se comunique con ustedes hoy mismo» sin cita", () => {
    const text = "Claro que sí, Valentina. Ya le aviso a Dayana para que se comunique con ustedes hoy mismo; ella te confirma por aquí el horario exacto.";
    expect(promiseBreach({ ...none, text })?.breach).toBe("same_day_promise");
  });

  test("lo que encontró la auditoría (14 y 15-oct)", () => {
    // Samy: ya había pasado su hora y no tenía cita.
    expect(promiseBreach({ ...none, text: "Dayana te estará llamando en unos momentos a este número, Samy." })?.breach).toBe("same_day_promise");
    expect(promiseBreach({ ...none, text: "Dayana te contactará en breve." })?.breach).toBe("same_day_promise");
    // «la negra bella»: falló la llamada por la señal.
    expect(promiseBreach({ ...none, text: "Claro que sí, intentamos de nuevo en un momento." })?.breach).toBe("same_day_promise");
    // «.»: aceptó la hora que dijo la persona sin mirar la agenda.
    expect(promiseBreach({ ...none, text: "Perfecto, a las 6:30 p. m. te queda bien. ¿Qué día te sirve?" })?.breach).toBe("invented_slots");
  });

  test("otras formas de prometer", () => {
    expect(promiseBreach({ ...none, text: "Listo, ya te agendé con Dayana." })?.breach).toBe("false_booking");
    expect(promiseBreach({ ...none, text: "Tu llamada está agendada." })?.breach).toBe("false_booking");
    expect(promiseBreach({ ...none, text: "Dayana te llama el sábado." })?.breach).toBe("false_booking");
    expect(promiseBreach({ ...none, text: "Hoy en la tarde Dayana te llama." })?.breach).toBe("same_day_promise");
  });
});

describe("lo que sí sale", () => {
  test("las horas que dio la agenda, tal cual", () => {
    const text = `Estos son los espacios libres de Dayana:\n• ${OFFERED[0]}\n• ${OFFERED[1]}\n¿Cuál te queda mejor?`;
    expect(promiseBreach({ ...none, backing: OFFERED, text })).toBeNull();
  });

  test("confirmar una cita que sí se agendó", () => {
    const text = "Listo, tu llamada queda agendada para el lunes 19 de octubre a las 8:15 a. m. (tu hora). Dayana te llama por WhatsApp a este número.";
    expect(promiseBreach({ backing: [OFFERED[1]!], hasBooking: true, bookingToday: false, text })).toBeNull();
  });

  test("«hoy» con una cita de hoy", () => {
    const text = "Recuerda que hoy Dayana te llama a las 7:15 p. m.";
    expect(promiseBreach({ backing: ["7:15 p. m."], hasBooking: true, bookingToday: true, text })).toBeNull();
  });

  test("las horas de un evento o del curso vienen de los datos", () => {
    expect(promiseBreach({ ...none, text: "El webinar gratuito es el domingo 25 de octubre a las 9:30 a. m. (hora de Colombia)." })).toBeNull();
    expect(promiseBreach({ ...none, text: "El curso en vivo es los miércoles a las 6:00 p. m.; si quieres, te comparto el enlace." })).toBeNull();
  });

  test("frases sin promesa", () => {
    expect(promiseBreach({ ...none, text: "Hola, te bendigo. ¿Cómo estás hoy?" })).toBeNull();
    expect(promiseBreach({ ...none, text: "Si quieres, te agendo una llamada gratis de 15 minutos con Dayana, sin costo ni compromiso." })).toBeNull();
    expect(promiseBreach({ ...none, text: "Recibido, Dayana lo revisa y te confirmamos. Tu pago quedó confirmado cuando ella lo vea." })).toBeNull();
    expect(promiseBreach({ ...none, text: "Por favor dime qué día y hora te quedan bien y Dayana te confirma por aquí." })).toBeNull();
  });
});
