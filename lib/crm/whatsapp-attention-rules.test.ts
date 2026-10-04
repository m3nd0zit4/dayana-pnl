import { describe, expect, test } from "bun:test";
import {
  appointmentCoversUntil,
  appointmentJustLinked,
  burstState,
  canClose,
  closesAttention,
  firstNeedingReply,
  isManualPause,
  isSensitiveEscalation,
  MANUAL_PAUSE_REASON,
  trivialKind,
  inboundSinceLastReply,
  isHumanSend,
  isPending,
  isTrivialMessage,
  lastInboundSeen,
  mergeAttention,
  needsReply,
  opensAttention,
  repliedSince,
  replyStateOf,
  sendClearsUnread,
  type BurstMessage,
  type ReplyMessage,
} from "./whatsapp-attention-rules";

const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 12, min));

describe("isTrivialMessage: lo que no pide respuesta", () => {
  const trivial = (body: string) => isTrivialMessage({ body });

  test("agradecimientos, con y sin tildes, emojis o letras repetidas", () => {
    for (const body of [
      "gracias",
      "Gracias!!",
      "Muchas gracias 🙏",
      "muchísimas gracias",
      "Mil gracias",
      "graciaaas",
      "Gracias a ti",
      "Gracias igualmente",
      "gracias Dayana ❤️",
      "Gracias, doctora.",
    ]) {
      expect(trivial(body)).toBe(true);
    }
  });

  test("«ok» y sus formas (un «ok», no un «gracias»)", () => {
    for (const body of ["ok", "Ok.", "OKAY", "Okey 👍", "oki", "okkk", "Ok gracias"]) {
      expect(trivialKind({ body })).toBe("ack");
    }
    expect(trivialKind({ body: "Muchas gracias 🙏" })).toBe("thanks");
  });

  test("«listo» no es trivial: después de un enlace de pago es «ya pagué»", () => {
    for (const body of ["Listo", "listo, gracias", "Lista"]) {
      expect(trivial(body)).toBe(false);
    }
  });

  test("bendiciones, amén, igualmente", () => {
    for (const body of ["Amén", "amén 🙏🏽", "Bendiciones", "Te bendigo", "Dios te bendiga", "Que Dios te bendiga", "Igualmente"]) {
      expect(trivial(body)).toBe(true);
    }
  });

  test("solo emojis o un sticker: como un «ok»", () => {
    for (const body of ["👍", "🙏", "🙏🏽", "❤️", "😊😊", "👍🏻❤️"]) {
      expect(trivialKind({ body })).toBe("ack");
    }
    expect(trivialKind({ body: null, attachments: [{ kind: "sticker" }] })).toBe("ack");
  });

  test("las reacciones llegan como aviso gris (system): no cuentan; un texto «Reaccionó…» escrito sí", () => {
    expect(isTrivialMessage({ body: "Reaccionó ❤️", kind: "system" })).toBe(true);
    expect(isTrivialMessage({ body: "Encuesta: ¿qué día?", kind: "system" })).toBe(true);
    expect(isTrivialMessage({ body: "Reaccionó ❤️" })).toBe(false);
  });

  test("un saludo, una pregunta o algo concreto sí piden respuesta", () => {
    for (const body of [
      "Hola",
      "Hola, quiero una cita",
      "gracias, ¿y cuánto cuesta?",
      "ok?",
      "¿Listo?",
      "No gracias",
      "Gracias, mañana te pago",
      "Ok, el jueves a las 3",
      "Listo, ya pagué",
      "Te quiero preguntar algo",
      "Me siento muy mal",
    ]) {
      expect(trivial(body)).toBe(false);
    }
  });

  test("una foto, un audio o un documento nunca son triviales (puede ser un comprobante)", () => {
    expect(isTrivialMessage({ body: "gracias", attachments: [{ kind: "image" }] })).toBe(false);
    expect(isTrivialMessage({ body: null, attachments: [{ kind: "audio" }] })).toBe(false);
    expect(isTrivialMessage({ body: "", attachments: [{ kind: "document" }] })).toBe(false);
  });

  test("un mensaje vacío sin nada que leer no se da por trivial", () => {
    expect(isTrivialMessage({ body: "" })).toBe(false);
    expect(isTrivialMessage({ body: null })).toBe(false);
  });

  test("un texto largo no es un «gracias»", () => {
    expect(trivial("gracias ".repeat(12))).toBe(false);
  });
});

const msg = (m: Partial<BurstMessage>): BurstMessage => ({
  direction: "OUTBOUND",
  isEcho: false,
  isAutoReply: false,
  source: null,
  kind: "message",
  status: "SENT",
  clientKey: null,
  body: "x",
  ...m,
});

describe("inboundSinceLastReply / needsReply (del más nuevo al más viejo)", () => {
  test("la ráfaga se corta en la última respuesta (de Dayana o de la IA)", () => {
    const burst = inboundSinceLastReply([
      msg({ direction: "INBOUND", body: "gracias" }),
      msg({ direction: "INBOUND", body: "¿me agendas?" }),
      msg({ isAutoReply: true, body: "Con gusto" }),
      msg({ direction: "INBOUND", body: "hola" }),
    ]);
    expect(burst.map((m) => m.body)).toEqual(["gracias", "¿me agendas?"]);
    expect(needsReply(burst)).toBe(true);
  });

  test("recordatorios, masivos, avisos y lo que falló no cortan la ráfaga", () => {
    const burst = inboundSinceLastReply([
      msg({ source: "recordatorio:e1", isAutoReply: true }),
      msg({ direction: "INBOUND", kind: "system", body: "Reaccionó 👍" }),
      msg({ status: "FAILED" }),
      msg({ direction: "INBOUND", body: "¿a qué hora?" }),
      msg({ isEcho: true }),
    ]);
    expect(burst.map((m) => m.body)).toEqual(["¿a qué hora?"]);
  });

  test("el recordatorio del taller tampoco: «¿cuál es el link?» sigue sin respuesta", () => {
    const burst = inboundSinceLastReply([
      msg({ source: "taller:ed1:1h", isAutoReply: true, body: "Hoy es el taller 🌿" }),
      msg({ clientKey: "taller:ed1:24h", isAutoReply: true, body: "Mañana es el taller" }),
      msg({ direction: "INBOUND", body: "¿cuál es el link?" }),
      msg({ isEcho: true }),
    ]);
    expect(burst.map((m) => m.body)).toEqual(["¿cuál es el link?"]);
    expect(needsReply(burst)).toBe(true);
  });

  test("solo «gracias» después de contestar: no pide respuesta", () => {
    const burst = inboundSinceLastReply([msg({ direction: "INBOUND", body: "Muchas gracias 🙏" }), msg({ isEcho: true })]);
    expect(needsReply(burst)).toBe(false);
    expect(needsReply([])).toBe(false);
  });

  test("desde cuándo espera: el primer mensaje que importa", () => {
    expect(
      firstNeedingReply([
        { body: "¿y el precio?", sentAt: at(5) },
        { body: "👍", sentAt: at(3) },
        { body: "hola, una pregunta", sentAt: at(4) },
      ])?.getTime()
    ).toBe(at(4).getTime());
    expect(firstNeedingReply([{ body: "gracias", sentAt: at(1) }])).toBeNull();
    // Si le habíamos preguntado algo, el 👍 ya es la respuesta.
    expect(firstNeedingReply([{ body: "👍", sentAt: at(3) }], true)?.getTime()).toBe(at(3).getTime());
  });

  test("una propuesta aprobada no corta la ráfaga: cubre hasta lo que la IA leyó", () => {
    const messages = [
      msg({ source: "approval", body: "Claro, te ayudo", sentAt: at(9) }),
      msg({ direction: "INBOUND", body: "¿y el precio?", sentAt: at(8) }),
      msg({ direction: "INBOUND", body: "Hola, quiero una cita", sentAt: at(5) }),
    ];
    expect(inboundSinceLastReply(messages, at(5)).map((m) => m.body)).toEqual(["¿y el precio?"]);
    expect(inboundSinceLastReply(messages, at(8))).toEqual([]);
  });
});

describe("burstState: lo que escribió según lo que le dijimos", () => {
  const thread = (prev: Partial<BurstMessage>, reply: string) => [
    msg({ direction: "INBOUND", body: reply, sentAt: at(10) }),
    msg({ sentAt: at(5), ...prev }),
  ];

  test("«gracias» nunca pide respuesta, ni después de una pregunta o un recordatorio", () => {
    expect(burstState(thread({ body: "¿Te sirve el jueves?" }, "Gracias 🙏")).needsReply).toBe(false);
    expect(burstState(thread({ body: "Te recuerdo tu cita de mañana", source: "recordatorio:e1", isAutoReply: true }, "gracias")).needsReply).toBe(false);
    expect(burstState(thread({ body: "Con gusto, te espero" }, "gracias")).needsReply).toBe(false);
  });

  test("«ok», 👍 o un sticker después de una pregunta, un enlace, una invitación o un recordatorio: es un «sí»", () => {
    expect(burstState(thread({ body: "¿Te sirve el jueves a las 3?" }, "ok")).needsReply).toBe(true);
    expect(burstState(thread({ body: "Aquí tienes el enlace: https://pago.example/x" }, "👍")).needsReply).toBe(true);
    expect(burstState(thread({ body: "Te invito al taller del sábado", source: "bulk:s1" }, "ok")).needsReply).toBe(true);
    expect(burstState(thread({ body: "Te recuerdo tu cita de mañana", source: "recordatorio:e1", isAutoReply: true }, "ok")).needsReply).toBe(true);
  });

  test("«ok» a algo que no preguntaba nada: no pide respuesta", () => {
    expect(burstState(thread({ body: "Te espero el jueves" }, "ok")).needsReply).toBe(false);
  });

  test("con horas, una cita o un enlace de pago aprobados hace poco, un «ok» es un «sí»", () => {
    const s = burstState(thread({ body: "Perfecto" }, "ok"), { recentOffer: true });
    expect(s.needsReply).toBe(true);
    expect(s.since?.getTime()).toBe(at(10).getTime());
  });

  test("lo que le dijimos DESPUÉS de su mensaje no cuenta como pregunta", () => {
    const messages = [
      msg({ source: "approval", body: "¿Te sirve el jueves?", sentAt: at(12) }),
      msg({ direction: "INBOUND", body: "ok", sentAt: at(10) }),
      msg({ body: "Te espero", sentAt: at(5) }),
    ];
    expect(burstState(messages).needsReply).toBe(false);
  });
});

describe("isHumanSend (y sendClearsUnread)", () => {
  test("Dayana desde el CRM o aprobando una propuesta", () => {
    expect(isHumanSend({ staffUserId: "s1" })).toBe(true);
    expect(isHumanSend({ staffUserId: "s1", source: "crm:perfil" })).toBe(true);
    expect(isHumanSend({ staffUserId: "s1", isAutoReply: true, source: "approval" })).toBe(true);
    expect(isHumanSend({ staffUserId: "s1", source: "autoevaluacion" })).toBe(true);
  });

  test("la IA, el saludo, los recordatorios, el evento y los masivos no", () => {
    expect(isHumanSend({ isAutoReply: true })).toBe(false);
    expect(isHumanSend({})).toBe(false);
    expect(isHumanSend({ isAutoReply: true, source: "recordatorio:evt" })).toBe(false);
    expect(isHumanSend({ isAutoReply: true, clientKey: "welcome:c1" })).toBe(false);
    expect(isHumanSend({ staffUserId: "s1", source: "bulk:abc" })).toBe(false);
    // «Reintentar WA» de un recordatorio del evento lo pulsa Dayana, pero no contesta a nadie.
    expect(isHumanSend({ staffUserId: "s1", source: "evento:fw1:24h" })).toBe(false);
    // Los recordatorios del taller (`taller:<edición>:<pase>`), por `source` o por clave.
    expect(isHumanSend({ isAutoReply: true, source: "taller:ed1:24h" })).toBe(false);
    expect(isHumanSend({ staffUserId: "s1", source: "taller:ed1:24h" })).toBe(false);
    expect(isHumanSend({ isAutoReply: true, clientKey: "taller:ed1:1h" })).toBe(false);
  });

  test("reenviar algo que escribió la IA no cuenta como respuesta suya", () => {
    expect(isHumanSend({ staffUserId: "s1", isAutoReply: true, source: "resend:m1" })).toBe(false);
  });

  test("dejar el chat leído sigue el mismo criterio", () => {
    expect(sendClearsUnread({ staffUserId: "s1" })).toBe(true);
    expect(sendClearsUnread({ isAutoReply: true })).toBe(false);
  });
});

describe("abrir y cerrar «Te toca»", () => {
  test("qué saltos de la IA abren «Te toca» (si el mensaje importa)", () => {
    for (const r of ["manual", "favorite", "disabled", "owner_hours", "customer", "paused", "human_replied", "assigned"]) {
      expect(opensAttention(r)).toBe(true);
    }
    for (const r of ["known_contact", "no_inbound", "not_found", "trivial", "replied_meanwhile", null]) {
      expect(opensAttention(r)).toBe(false);
    }
  });

  test("se queda la fecha más vieja; una escalada pisa «sin responder», no al revés", () => {
    expect(mergeAttention({ at: null, reason: null }, { at: at(5), reason: "unanswered" })).toEqual({
      at: at(5),
      reason: "unanswered",
    });
    expect(mergeAttention({ at: at(2), reason: "unanswered" }, { at: at(5), reason: "payment" })).toEqual({
      at: at(2),
      reason: "payment",
    });
    expect(mergeAttention({ at: at(2), reason: "payment" }, { at: at(5), reason: "unanswered" })).toBeNull();
    expect(mergeAttention({ at: at(5), reason: "booking" }, { at: at(2), reason: "unanswered" })).toEqual({
      at: at(2),
      reason: "booking",
    });
  });

  test("cada cosa cierra solo lo suyo", () => {
    const open = (reason: string, urgent = false) => ({ reason, urgent });
    // Contestar o «Listo»: todo.
    for (const r of ["unanswered", "payment", "clinical", "complaint", "booking"]) {
      expect(canClose("reply", open(r))).toBe(true);
      expect(canClose("listo", open(r, true))).toBe(true);
    }
    // Aprobar lo que propuso la IA: nunca algo delicado o urgente.
    expect(canClose("approval", open("unanswered"))).toBe(true);
    expect(canClose("approval", open("payment"))).toBe(true);
    expect(canClose("approval", open("clinical"))).toBe(false);
    expect(canClose("approval", open("other", true))).toBe(false);
    // Una cita: lo que pedía cita. Un pago: lo que era de un pago.
    expect(canClose("appointment", open("booking"))).toBe(true);
    expect(canClose("appointment", open("reschedule"))).toBe(true);
    expect(canClose("appointment", open("unanswered"))).toBe(true);
    expect(canClose("appointment", open("payment"))).toBe(false);
    expect(canClose("appointment", open("clinical"))).toBe(false);
    expect(canClose("payment", open("payment"))).toBe(true);
    expect(canClose("payment", open("booking"))).toBe(false);
    expect(canClose("payment", open("complaint"))).toBe(false);
    // La IA: solo «sin responder».
    expect(canClose("ai", open("unanswered"))).toBe(true);
    expect(canClose("ai", open("booking"))).toBe(false);
  });

  test("una pausa a mano no es una escalada", () => {
    expect(isManualPause({ category: null, reason: null })).toBe(true);
    expect(isManualPause({ category: "other", reason: MANUAL_PAUSE_REASON })).toBe(true);
    expect(isManualPause({ category: "other", reason: "La persona pide algo raro" })).toBe(false);
    expect(isManualPause({ category: "clinical", reason: MANUAL_PAUSE_REASON })).toBe(false);
  });

  test("escaladas delicadas: clínica, pago o urgente", () => {
    expect(isSensitiveEscalation({ category: "clinical", severity: "normal" })).toBe(true);
    expect(isSensitiveEscalation({ category: "payment", severity: null })).toBe(true);
    expect(isSensitiveEscalation({ category: "other", severity: "urgent" })).toBe(true);
    expect(isSensitiveEscalation({ category: "unknown", severity: "normal" })).toBe(false);
    expect(isSensitiveEscalation({ category: "booking", severity: null })).toBe(false);
  });

  test("una respuesta solo cierra lo que se abrió antes de ella (ecos en desorden)", () => {
    expect(closesAttention(at(5), at(6))).toBe(true);
    expect(closesAttention(at(5), at(5))).toBe(true);
    expect(closesAttention(at(5), at(4))).toBe(false);
    expect(closesAttention(null, at(9))).toBe(false);
    expect(closesAttention(at(5).toISOString(), at(6))).toBe(true);
  });

  test("¿contestó Dayana mientras la IA esperaba?", () => {
    expect(repliedSince(at(6), at(5))).toBe(true);
    // El mismo segundo cuenta como contestado: mejor callar que pisarla.
    expect(repliedSince(at(5), at(5))).toBe(true);
    expect(repliedSince(at(4), at(5))).toBe(false);
    expect(repliedSince(null, at(5))).toBe(false);
    expect(repliedSince(at(5), null)).toBe(false);
  });
});

const reply = (m: Partial<ReplyMessage>): ReplyMessage => ({
  direction: "OUTBOUND",
  isEcho: false,
  isAutoReply: false,
  source: null,
  kind: "message",
  status: "SENT",
  clientKey: null,
  ...m,
});

describe("replyStateOf (del más nuevo al más viejo)", () => {
  test("lo último es de la persona: sin responder", () => {
    expect(replyStateOf([reply({ direction: "INBOUND", status: "RECEIVED" }), reply({})])).toBe("unanswered");
  });

  test("Dayana desde el CRM, desde el celular, la IA, una propuesta aprobada", () => {
    expect(replyStateOf([reply({ source: null }), reply({ direction: "INBOUND" })])).toBe("you");
    expect(replyStateOf([reply({ isEcho: true })])).toBe("you_phone");
    expect(replyStateOf([reply({ isAutoReply: true })])).toBe("ai");
    expect(replyStateOf([reply({ isAutoReply: true, source: "approval" })])).toBe("you");
  });

  test("recordatorios, masivos y saludo no son una respuesta", () => {
    expect(replyStateOf([reply({ isAutoReply: true, source: "recordatorio:evt1" })])).toBe("auto");
    expect(replyStateOf([reply({ isAutoReply: true, source: "evento:fw1:24h" })])).toBe("auto");
    expect(replyStateOf([reply({ isAutoReply: true, source: "taller:ed1:24h" })])).toBe("auto");
    expect(replyStateOf([reply({ isAutoReply: true, clientKey: "taller:ed1:1h" })])).toBe("auto");
    expect(replyStateOf([reply({ source: "bulk:abc" })])).toBe("auto");
    expect(replyStateOf([reply({ isAutoReply: true, clientKey: "welcome:conv1" })])).toBe("auto");
  });

  test("los avisos grises y lo que no se entregó se saltan", () => {
    expect(
      replyStateOf([
        reply({ direction: "INBOUND", kind: "system" }),
        reply({ status: "FAILED" }),
        reply({ isEcho: true }),
        reply({ direction: "INBOUND" }),
      ])
    ).toBe("you_phone");
    expect(replyStateOf([])).toBeNull();
  });
});

test("isPending (historial): escribió después de la última resolución", () => {
  expect(isPending({ lastInboundAt: null, resolvedAt: null })).toBe(false);
  expect(isPending({ lastInboundAt: at(0), resolvedAt: null })).toBe(true);
  expect(isPending({ lastInboundAt: at(0), resolvedAt: at(1) })).toBe(false);
  expect(isPending({ lastInboundAt: at(2), resolvedAt: at(1) })).toBe(true);
});

describe("appointmentJustLinked (solo en el cambio)", () => {
  const now = at(0);
  const later = new Date(now.getTime() + 48 * 3600_000);
  const base = { phone: "573000000001", contactId: null, startsAt: later, now };

  test("cita nueva y futura con número: sí; sin número o ya pasada: no", () => {
    expect(appointmentJustLinked({ ...base, before: null })).toBe(true);
    expect(appointmentJustLinked({ ...base, phone: null, before: null })).toBe(false);
    expect(appointmentJustLinked({ ...base, startsAt: at(-60), before: null })).toBe(false);
  });

  test("la misma cita en otra pasada: no; número nuevo, cita que vuelve o se mueve: sí", () => {
    expect(appointmentJustLinked({ ...base, before: { phone: base.phone, status: "active", startsAt: later } })).toBe(false);
    expect(appointmentJustLinked({ ...base, before: { phone: null, status: "active", startsAt: later } })).toBe(true);
    expect(appointmentJustLinked({ ...base, before: { phone: base.phone, status: "cancelled", startsAt: later } })).toBe(true);
    expect(
      appointmentJustLinked({ ...base, before: { phone: base.phone, status: "active", startsAt: new Date(later.getTime() + 3600_000) } })
    ).toBe(true);
  });
});

test("appointmentCoversUntil: hasta que Dayana creó o movió el evento", () => {
  const now = at(30);
  expect(appointmentCoversUntil(at(10).toISOString(), now).getTime()).toBe(at(10).getTime());
  expect(appointmentCoversUntil(null, now).getTime()).toBe(now.getTime());
  expect(appointmentCoversUntil("no-es-fecha", now).getTime()).toBe(now.getTime());
  expect(appointmentCoversUntil(at(50).toISOString(), now).getTime()).toBe(now.getTime());
});

test("lastInboundSeen: el último mensaje de la persona que la IA leyó", () => {
  const start = at(30);
  expect(
    lastInboundSeen(
      [
        { direction: "INBOUND", sentAt: at(1) },
        { direction: "OUTBOUND", sentAt: at(5) },
        { direction: "INBOUND", sentAt: at(7) },
      ],
      start
    ).getTime()
  ).toBe(at(7).getTime());
  expect(lastInboundSeen([{ direction: "INBOUND" }], start).getTime()).toBe(start.getTime());
});
