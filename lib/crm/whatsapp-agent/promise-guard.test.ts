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

  test("Sophie: horas inventadas y «queda agendada» sin cita", () => {
    expect(
      promiseBreach({ ...none, text: "Perfecto, Sophie. Si te parece bien, tengo disponible este sábado a las 10:00 a. m. o a las 3:00 p. m. de Colombia. Dime cuál te queda mejor y te agendo." })?.breach
    ).toBe("invented_slots");
    expect(promiseBreach({ ...none, text: "Perfecto, Sophie. Tu llamada queda agendada para este sábado a las 3:00 p. m. de Colombia." })?.breach).toBe("false_booking");
  });

  test("lo que el revisor vio que se escapaba", () => {
    expect(promiseBreach({ ...none, text: "Listo, Lucía. Quedó tu llamada gratis el jueves 15 de octubre a las 3:00 p. m." })?.breach).toBe("false_booking");
    expect(promiseBreach({ ...none, text: "Dayana te va a llamar en unos minutos." })?.breach).toBe("same_day_promise");
    expect(promiseBreach({ ...none, text: "Dayana te llama más tarde, tranquila." })?.breach).toBe("same_day_promise");
    expect(promiseBreach({ ...none, text: "Dayana se pondrá en contacto hoy contigo." })?.breach).toBe("same_day_promise");
    expect(promiseBreach({ ...none, text: "Para la llamada tengo a las 10 o a las 4, ¿cuál te sirve?" })?.breach).toBe("invented_slots");
    expect(promiseBreach({ ...none, text: "Te puedo agendar la llamada a las 18:45." })?.breach).toBe("invented_slots");
    // Mencionar el live no apaga el freno en la frase de las horas.
    expect(promiseBreach({ ...none, text: "Qué bueno que te gustó el live. Para tu llamada tengo el sábado a las 10:00 a. m." })?.breach).toBe("invented_slots");
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

  test("lo que el revisor vio que se bloqueaba sin razón", () => {
    expect(promiseBreach({ ...none, text: "¿Quieres que te agende la llamada gratis de 15 minutos?" })).toBeNull();
    expect(promiseBreach({ ...none, text: "Dayana te llama el día que elijas, por WhatsApp." })).toBeNull();
    expect(promiseBreach({ ...none, text: "Tu llamada queda para cuando tú elijas." })).toBeNull();
    expect(promiseBreach({ ...none, text: "Tu cupo para el webinar quedó reservado." })).toBeNull();
    expect(promiseBreach({ ...none, text: "Tu inscripción al taller quedó confirmada." })).toBeNull();
    // Las horas de Dayana sin a. m./p. m. valen si coinciden con lo que ella dio.
    expect(promiseBreach({ ...none, backing: ["• Jueves, 15 de octubre, 6:45 p. m."], text: "Perfecto, el jueves a las 6:45 queda tu llamada." })?.breach).toBe("false_booking");
    expect(promiseBreach({ ...none, backing: ["• Jueves, 15 de octubre, 6:45 p. m."], text: "¿Te sirve el jueves a las 6:45 para la llamada?" })).toBeNull();
  });

  test("ofrecer una hora de hoy que dio la agenda (17-oct: hoy y mañana van primero)", () => {
    const backing = ["lunes, 19 de octubre, 4:00 p. m.", "martes, 20 de octubre, 9:00 a. m."];
    expect(promiseBreach({ ...none, backing, text: "¿Te sirve que Dayana te llame hoy a las 4:00 p. m. o mañana a las 9:00 a. m.?" })).toBeNull();
    expect(promiseBreach({ ...none, backing, text: "¿Te parece si Dayana te llama hoy a las 4:00 p. m.?" })).toBeNull();
    // Con una hora que la agenda no dio, o afirmándolo sin cita, sigue frenado.
    expect(promiseBreach({ ...none, backing, text: "¿Te sirve que Dayana te llame hoy a las 6:00 p. m.?" })?.breach).toBe("same_day_promise");
    expect(promiseBreach({ ...none, backing, text: "Listo, Dayana te llama hoy a las 4:00 p. m." })?.breach).toBe("false_booking");
    expect(promiseBreach({ ...none, backing, text: "Dayana te llama hoy mismo." })?.breach).toBe("false_booking");
  });

  test("frases sin promesa", () => {
    expect(promiseBreach({ ...none, text: "Hola, te bendigo. ¿Cómo estás hoy?" })).toBeNull();
    expect(promiseBreach({ ...none, text: "Si quieres, te agendo una llamada gratis de 15 minutos con Dayana, sin costo ni compromiso." })).toBeNull();
    expect(promiseBreach({ ...none, text: "Recibido, Dayana lo revisa y te confirmamos. Tu pago quedó confirmado cuando ella lo vea." })).toBeNull();
    expect(promiseBreach({ ...none, text: "Por favor dime qué día y hora te quedan bien y Dayana te confirma por aquí." })).toBeNull();
  });
});

describe("lo que pasó el 18-oct", () => {
  // La agenda le dio horas de ese mismo domingo a Danilo (pidió «mañana en la tarde», la tarde del lunes estaba llena).
  const DANILO = ["domingo, 18 de octubre, 4:30 p. m.", "domingo, 18 de octubre, 4:45 p. m.", "domingo, 18 de octubre, 5:00 p. m."];

  test("Danilo: horas de hoy que dio la agenda, con la pregunta en la frase siguiente, sí salen", () => {
    const text =
      "Para mañana en la tarde Dayana ya no tiene espacio, Danilo, pero hoy mismo hay estos horarios: 4:30 p. m., 4:45 p. m. o 5:00 p. m. ¿Alguno te sirve?";
    expect(promiseBreach({ ...none, backing: DANILO, text })).toBeNull();
    // Sin horas de la agenda sigue siendo una promesa.
    expect(promiseBreach({ ...none, text: "Ya le aviso a Dayana para que te escriba hoy mismo. ¿Te parece?" })?.breach).toBe("same_day_promise");
    // Y con horas que no dio la agenda, también.
    expect(promiseBreach({ ...none, backing: DANILO, text: "Hoy mismo a las 7:00 p. m. ¿Te sirve?" })).not.toBeNull();
  });

  test("Fely: «las grabaciones están en el grupo» no sale (no hay grabaciones)", () => {
    expect(promiseBreach({ ...none, text: "Las grabaciones de las clases y webinars están en el grupo. Puedes revisarlas allí 🙏" })?.breach).toBe("recordings");
    expect(promiseBreach({ ...none, text: "Sí, el webinar queda grabado y te lo mando." })?.breach).toBe("recordings");
    // Decir que no hay sí puede.
    expect(promiseBreach({ ...none, text: "El webinar gratuito no queda grabado; te esperamos en vivo el domingo 🙏" })).toBeNull();
    expect(promiseBreach({ ...none, text: "Con gusto 🙏" })).toBeNull();
  });
});
