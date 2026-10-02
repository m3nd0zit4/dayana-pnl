import { describe, expect, test } from "bun:test";
import {
  appointmentCoversUntil,
  appointmentJustLinked,
  closesAttention,
  firstNeedingReply,
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

  test("«ok», «listo» y sus formas", () => {
    for (const body of ["ok", "Ok.", "OKAY", "Okey 👍", "oki", "okkk", "Listo", "listo, gracias", "Ok gracias"]) {
      expect(trivial(body)).toBe(true);
    }
  });

  test("bendiciones, amén, igualmente", () => {
    for (const body of ["Amén", "amén 🙏🏽", "Bendiciones", "Te bendigo", "Dios te bendiga", "Que Dios te bendiga", "Igualmente"]) {
      expect(trivial(body)).toBe(true);
    }
  });

  test("solo emojis", () => {
    for (const body of ["👍", "🙏", "🙏🏽", "❤️", "😊😊", "👍🏻❤️"]) {
      expect(trivial(body)).toBe(true);
    }
  });

  test("sticker, reacción y avisos grises", () => {
    expect(isTrivialMessage({ body: null, attachments: [{ kind: "sticker" }] })).toBe(true);
    expect(isTrivialMessage({ body: "Reaccionó ❤️" })).toBe(true);
    expect(isTrivialMessage({ body: "Quitó una reacción" })).toBe(true);
    expect(isTrivialMessage({ body: "Encuesta: ¿qué día?", kind: "system" })).toBe(true);
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
