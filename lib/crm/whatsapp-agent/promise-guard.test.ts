import { describe, expect, test } from "bun:test";

import { confirmsCall, promiseBreach, timesIn } from "./promise-guard";

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

describe("lo que pasó el 19-oct", () => {
  // Raquel (+34, «España»): la agenda le dio «jueves, 22 de octubre, 7:00 p. m. (tu hora) · 12:00 p. m. en Colombia».
  const raquel = "Tu llamada queda para el jueves, 22 de octubre, a las 7:00 p. m. (tu hora). Dayana te llama por WhatsApp a este número.";
  test("con la hora de su zona en el respaldo, su cita sale", () => {
    expect(promiseBreach({ text: raquel, backing: ["12:00 p. m.", "7:00 p. m."], hasBooking: true, bookingToday: false })).toBeNull();
  });
  test("solo con la hora de Colombia se frenaba (lo que pasó)", () => {
    expect(promiseBreach({ text: raquel, backing: ["12:00 p. m."], hasBooking: true, bookingToday: false })?.breach).toBe("invented_slots");
  });
});

describe("21-oct: «queda para…» sin cita, o a otra hora de la que tiene (no sale)", () => {
  test("Natalia: «tu llamada con Dayana queda para hoy» y book_free_call falló", () => {
    const text = "Tu llamada con Dayana queda para hoy, miércoles 21 de octubre, a las 12:45 p. m. de tu hora (y de Colombia). Dayana te llama por WhatsApp a este número.";
    expect(promiseBreach({ ...none, backing: ["miércoles, 21 de octubre, 12:45 p. m."], text })?.breach).toBe("false_booking");
  });

  test("Caicedo / Barbara: «queda para el jueves / viernes» sin ninguna cita", () => {
    expect(promiseBreach({ ...none, text: "Perfecto, tu llamada con Dayana queda para el jueves 22 de octubre, a las 12:15 p. m. de Ecuador." })?.breach).toBe("false_booking");
    expect(promiseBreach({ ...none, text: "Listo, queda para el viernes a las 9:00 a. m." })?.breach).toBe("false_booking");
  });

  test("Alexandra: tiene el jueves 12:30 y le confirman el viernes 9:00", () => {
    const base = { backing: ["viernes, 23 de octubre, 9:00 a. m."], hasBooking: true, bookingToday: false, bookedLabels: ["jueves 12:30 p. m."] };
    const text = "Tu llamada con Dayana queda para el viernes, 23 de octubre, a las 9:00 a. m. de tu hora. Ella te llama por WhatsApp a este número, Alexandra.";
    expect(promiseBreach({ ...base, text })?.breach).toBe("false_booking");
    expect(promiseBreach({ ...base, text: "Así es, Alexandra. Tu llamada con Dayana queda confirmada para el viernes, 23 de octubre, a las 9:00 a. m." })?.breach).toBe("false_booking");
  });

  test("la cita que sí tiene (o la que se acaba de mover) sale", () => {
    const booked = ["viernes 9:00 a. m.", "viernes 10:00 a. m."];
    // Como en run.ts: las horas de sus citas también respaldan.
    const base = { backing: booked, hasBooking: true, bookingToday: false, bookedLabels: booked };
    expect(promiseBreach({ ...base, text: "Tu llamada con Dayana queda para el viernes, 23 de octubre, a las 9:00 a. m. de tu hora (10:00 a. m. en Colombia)." })).toBeNull();
    expect(promiseBreach({ ...base, text: "Tu llamada queda agendada. Dayana te llama por WhatsApp a este número." })).toBeNull();
  });

  test("después de moverla: «ya no es el jueves: queda para el viernes…» sale", () => {
    const booked = ["viernes 10:00 a. m."];
    const base = { backing: booked, hasBooking: true, bookingToday: false, bookedLabels: booked };
    expect(promiseBreach({ ...base, text: "Listo, ya no es el jueves: tu llamada queda para el viernes a las 10:00 a. m." })).toBeNull();
  });

  test("ofrecer no es confirmar", () => {
    expect(promiseBreach({ ...none, backing: OFFERED, text: "¿Te queda bien el viernes a las 8:45 p. m.?" })).toBeNull();
  });
});

describe("21-oct, auditoría después de Natalia: lo que todavía se escapaba", () => {
  // La agenda dio el jueves 22 a las 3:00 p. m. y nada quedó agendado (como a
  // Natalia: book_free_call falló y la IA le confirmó la llamada igual).
  const JUEVES = ["jueves, 22 de octubre, 3:00 p. m."];
  const VIERNES = ["viernes, 23 de octubre, 3:00 p. m."];
  const verdict = (text: string, backing = JUEVES) => ({ text, breach: promiseBreach({ ...none, backing, text })?.breach ?? null });

  test("confirmar sin «ya» ni «te», o con otras palabras (no sale)", () => {
    for (const text of [
      "Listo, agendé tu llamada para el jueves 22 de octubre a las 3:00 p. m.",
      "Agendé tu llamada gratis con Dayana.",
      "Jueves 22 a las 3:00 p. m., Dayana te llama por WhatsApp.",
      "Perfecto, Dayana te llama por WhatsApp el jueves 22 a las 3:00 p. m.",
      "Ya quedó: jueves 22 de octubre, 3:00 p. m.",
      "Quedó para el jueves a las 3:00 p. m.",
      "Quedó para el próximo jueves a las 3:00 p. m.",
      "Tu llamada será el jueves a las 3:00 p. m.",
      "Tu llamada con Dayana es el jueves a las 3:00 p. m.",
      "Listo, te separé el espacio del jueves a las 3:00 p. m.",
      "Te anoté para el jueves a las 3:00 p. m.",
      "Listo, te dejé agendada para el jueves.",
      "Quedaste agendada para el jueves.",
      "Tu llamada quedó programada para el jueves.",
    ]) {
      expect(verdict(text)).toEqual({ text, breach: "false_booking" });
    }
  });

  test("ofrecer, preguntar o explicar no es confirmar (sale)", () => {
    for (const text of [
      "¿Quieres que te agende la llamada gratis?",
      "¿Te agendo el jueves a las 3:00 p. m.?",
      "¿Quieres que agende tu llamada para el jueves a las 3:00 p. m.?",
      "¿Quieres que te separe el espacio del jueves a las 3:00 p. m.?",
      "Tu llamada queda para cuando elijas.",
      "Dayana te llama por WhatsApp a este número.",
      "Cuando la agendes, Dayana te llama por WhatsApp.",
      "Si te sirve el jueves a las 3:00 p. m., Dayana te llama por WhatsApp a este número.",
      "¿Te sirve el jueves a las 3:00 p. m.? Dayana te llama por WhatsApp a este número.",
      "No agendé tu llamada: esa hora ya no estaba libre. ¿Te sirve el jueves a las 3:00 p. m.?",
      "Tu llamada es de 15 minutos, por WhatsApp.",
      "Tu llamada será por WhatsApp, a este número.",
      "Ya quedó claro, gracias 🙏",
      "Ya quedó tu registro al webinar del domingo.",
    ]) {
      expect(verdict(text)).toEqual({ text, breach: null });
    }
  });

  test("una frase con «pago», «cupo» o «grupo» que confirma la llamada sigue contando", () => {
    expect(verdict("Tu llamada queda para el viernes a las 3:00 p. m.; ahí Dayana te cuenta lo del pago.", VIERNES).breach).toBe("false_booking");
    expect(verdict("Listo, tu cita quedó agendada para el viernes y después te paso los datos del pago.", VIERNES).breach).toBe("false_booking");
    // Con cita, la del pago también tiene que ser la que tiene (Alexandra tenía el jueves).
    const alexandra = { backing: VIERNES, hasBooking: true, bookingToday: false, bookedLabels: ["jueves 12:30 p. m."] };
    expect(promiseBreach({ ...alexandra, text: "Tu llamada queda para el viernes a las 3:00 p. m.; ahí Dayana te cuenta lo del pago." })?.breach).toBe("false_booking");
    // Lo que se confirma del pago, del cupo o del grupo no es una cita.
    expect(verdict("Tu pago quedó confirmado; en la llamada Dayana te explica el siguiente paso.").breach).toBeNull();
    expect(verdict("Tu cupo en el grupo quedó reservado para el viernes.").breach).toBeNull();
    // Y las horas del evento siguen saliendo de sus datos.
    expect(verdict("El webinar es el domingo 25 a las 9:30 a. m.; si quieres, después te agendo una llamada.").breach).toBeNull();
  });

  test("una confirmación con «¿te parece?» al final sigue siendo una confirmación", () => {
    expect(verdict("Tu llamada queda para el jueves a las 3:00 p. m., ¿te parece?").breach).toBe("false_booking");
    expect(verdict("Listo, quedó agendada para el jueves a las 3:00 p. m., ¿te sirve?").breach).toBe("false_booking");
    // La pregunta que ofrece una hora de la agenda sí sale, con «¿» o sin él.
    expect(verdict("¿Te parece si Dayana te llama el jueves a las 3:00 p. m.?").breach).toBeNull();
    expect(verdict("Te parece si Dayana te llama el jueves a las 3:00 p. m.?").breach).toBeNull();
  });

  test("listas: cada línea con hora se mira cuando el mensaje es para agendar", () => {
    const text = "Dayana tiene estos espacios para tu llamada:\n• jueves 22, 5:00 p. m.\n• viernes 23, 4:00 p. m.\n¿Cuál prefieres?";
    expect(verdict(text).breach).toBe("invented_slots");
    expect(verdict("Para tu llamada:\n1. viernes 23 de octubre, 4:00 p. m.\n2. jueves 22 de octubre, 3:00 p. m.").breach).toBe("invented_slots");
    // Las de la agenda, tal cual, salen.
    expect(verdict(text, ["jueves, 22 de octubre, 5:00 p. m.", "viernes, 23 de octubre, 4:00 p. m."]).breach).toBeNull();
    // Las fechas del webinar en lista no son de la llamada, aunque al final se ofrezca una.
    const webinar =
      "Las próximas fechas del webinar gratuito:\n• domingo 25 de octubre, 9:30 a. m.\n• domingo 1 de noviembre, 9:30 a. m.\nSi quieres, también te agendo una llamada con Dayana.";
    expect(verdict(webinar).breach).toBeNull();
    // Un mensaje que no habla de agendar no se mira.
    expect(verdict("En Colombia ahora son las 5:00 p. m., Natalia. Con gusto te comparto la información.").breach).toBeNull();
    // Repetir lo que dijo la persona no es una línea de horarios.
    expect(verdict("Entiendo, el jueves sales del trabajo a las 5:00 p. m., así que miro otros días. ¿Cuál te queda mejor para la llamada?").breach).toBeNull();
    // Una línea sin viñeta que empieza por el día o por la hora, sí.
    expect(verdict("Para tu llamada Dayana tiene:\nViernes 23 de octubre, 4:00 p. m.").breach).toBe("invented_slots");
    expect(verdict("Para tu llamada, el jueves Dayana tiene:\n3:00 p. m.\n5:00 p. m.").breach).toBe("invented_slots");
    expect(verdict("Para tu llamada, el jueves Dayana tiene:\n3:00 p. m.").breach).toBeNull();
  });

  test("el día también cuenta: el viernes a la hora que la agenda dio para el jueves no sale", () => {
    expect(verdict("Para tu llamada tengo el viernes 23 a las 3:00 p. m. ¿Te sirve?").breach).toBe("invented_slots");
    expect(verdict("¿Te sirve el viernes a las 3:00 p. m. para la llamada?").breach).toBe("invented_slots");
    expect(verdict("Para tu llamada tengo el jueves 22 a las 3:00 p. m. o el viernes 23 a las 3:00 p. m. ¿Cuál prefieres?").breach).toBe("invented_slots");
    // El mismo día y hora, en sus dos zonas, sale.
    const raquel = ["jueves, 22 de octubre, 7:00 p. m. (tu hora) · 12:00 p. m. en Colombia"];
    expect(verdict("Para tu llamada tengo el jueves 22 a las 7:00 p. m. de tu hora (12:00 p. m. en Colombia). ¿Te sirve?", raquel).breach).toBeNull();
    // Pasada la medianoche, la hora de Colombia es del día anterior.
    const madrugada = ["viernes, 23 de octubre, 4:45 a. m. (tu hora) · 9:45 p. m. en Colombia"];
    expect(
      verdict("Para tu llamada tengo el viernes 23 a las 4:45 a. m. de tu hora (el jueves 22 a las 9:45 p. m. en Colombia). ¿Te sirve?", madrugada).breach
    ).toBeNull();
    // «a las 3:00 p. m. del viernes»: el día va después.
    expect(verdict("El jueves ya no hay espacio; ¿te sirve a las 3:00 p. m. del viernes para la llamada?", VIERNES).breach).toBeNull();
    // Una hora sin día (las de una oferta anterior, las de su cita) vale para cualquier día.
    expect(verdict("¿Te sirve el viernes a las 3:00 p. m. para la llamada?", ["3:00 p. m."]).breach).toBeNull();
    // «hoy» o «mañana» no se traducen a un día: cuenta solo la hora.
    expect(verdict("¿Te sirve mañana a las 3:00 p. m. para la llamada?").breach).toBeNull();
    expect(verdict("El jueves no se pudo, pero hoy mismo hay espacio a las 3:00 p. m. ¿Te sirve para la llamada?").breach).toBeNull();
  });

  test("con cita, el día y la hora que se confirman van juntos", () => {
    const booked = ["jueves 12:30 p. m.", "viernes 9:00 a. m."];
    const base = { backing: booked, hasBooking: true, bookingToday: false, bookedLabels: booked };
    expect(promiseBreach({ ...base, text: "Tu llamada queda para el viernes a las 12:30 p. m." })?.breach).toBe("false_booking");
    expect(promiseBreach({ ...base, text: "Tu llamada queda para el viernes a las 9:00 a. m." })).toBeNull();
  });

  test("horas escritas de otra forma: «15 h», «a las tres de la tarde»", () => {
    expect(timesIn("a las 15 h o a las 16h")).toEqual(["3:00p", "4:00p"]);
    expect(timesIn("a las tres de la tarde o a las diez y media de la mañana, o a la una de la tarde")).toEqual(["3:00p", "10:30a", "1:00p"]);
    expect(timesIn("la llamada dura 2 h; atención 24h; 15 horas; un día de 23 h; a las dos les escribo; las tres opciones")).toEqual([]);
    expect(verdict("Para tu llamada tengo el jueves a las cuatro de la tarde. ¿Te sirve?").breach).toBe("invented_slots");
    expect(verdict("Para tu llamada tengo el jueves a las 15 h. ¿Te sirve?").breach).toBeNull();
  });
});

describe("confirmsCall (Laura, 26-oct: la agenda el código si es la hora que eligió)", () => {
  test("confirmar la llamada", () => {
    expect(confirmsCall("Perfecto, Laura. Tu llamada con Dayana queda para el viernes 30 de octubre a las 9:00 a. m.")).toBe(true);
  });
  test("ofrecer horas o hablar de otra cosa no", () => {
    expect(confirmsCall("Con gusto, estas son las horas libres de Dayana")).toBe(false);
    expect(confirmsCall("Te entiendo. Si quieres, te agendo una llamada gratis de 15 minutos con ella.")).toBe(false);
  });
});
