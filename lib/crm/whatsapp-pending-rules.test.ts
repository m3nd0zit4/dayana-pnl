import { describe, expect, test } from "bun:test";
import {
  appointmentCoversUntil,
  appointmentJustLinked,
  isPending,
  lastInboundSeen,
  replyStateOf,
  resolvedLabel,
  sendClearsUnread,
  type ReplyMessage,
} from "./whatsapp-pending-rules";

const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 12, min));

describe("isPending", () => {
  test("sin mensajes de la persona no hay nada pendiente", () => {
    expect(isPending({ lastInboundAt: null, resolvedAt: null })).toBe(false);
    expect(isPending({ lastInboundAt: null, resolvedAt: at(5) })).toBe(false);
  });

  test("escribió y nadie lo resolvió: pendiente", () => {
    expect(isPending({ lastInboundAt: at(0), resolvedAt: null })).toBe(true);
  });

  test("resuelto después de su último mensaje: atendido", () => {
    expect(isPending({ lastInboundAt: at(0), resolvedAt: at(1) })).toBe(false);
    // En el mismo instante cuenta como atendido.
    expect(isPending({ lastInboundAt: at(1), resolvedAt: at(1) })).toBe(false);
  });

  test("un mensaje nuevo después de resolver lo reabre", () => {
    expect(isPending({ lastInboundAt: at(2), resolvedAt: at(1) })).toBe(true);
  });

  test("acepta fechas en texto (lo que llega a la pantalla)", () => {
    expect(isPending({ lastInboundAt: at(2).toISOString(), resolvedAt: at(1).toISOString() })).toBe(true);
    expect(isPending({ lastInboundAt: at(0).toISOString(), resolvedAt: at(1).toISOString() })).toBe(false);
  });
});

const msg = (m: Partial<ReplyMessage>): ReplyMessage => ({
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
    expect(replyStateOf([msg({ direction: "INBOUND", status: "RECEIVED" }), msg({})])).toBe("unanswered");
  });

  test("Dayana desde el CRM", () => {
    expect(replyStateOf([msg({ source: null }), msg({ direction: "INBOUND" })])).toBe("you");
    expect(replyStateOf([msg({ source: "crm:perfil" })])).toBe("you");
  });

  test("Dayana desde el celular (eco)", () => {
    expect(replyStateOf([msg({ isEcho: true })])).toBe("you_phone");
  });

  test("la IA sola", () => {
    expect(replyStateOf([msg({ isAutoReply: true })])).toBe("ai");
  });

  test("una propuesta de la IA aprobada por Dayana cuenta como suya", () => {
    expect(replyStateOf([msg({ isAutoReply: true, source: "approval" })])).toBe("you");
  });

  test("recordatorios, masivos y saludo no son una respuesta", () => {
    expect(replyStateOf([msg({ isAutoReply: true, source: "recordatorio:evt1" })])).toBe("auto");
    // Recordatorios del evento gratuito (24 h / 1 h).
    expect(replyStateOf([msg({ isAutoReply: true, source: "evento:fw1:24h" })])).toBe("auto");
    expect(replyStateOf([msg({ source: "bulk:abc" })])).toBe("auto");
    expect(replyStateOf([msg({ isAutoReply: true, clientKey: "welcome:conv1" })])).toBe("auto");
  });

  test("los avisos grises y lo que no se entregó se saltan", () => {
    expect(
      replyStateOf([
        msg({ direction: "INBOUND", kind: "system" }),
        msg({ status: "FAILED" }),
        msg({ isEcho: true }),
        msg({ direction: "INBOUND" }),
      ])
    ).toBe("you_phone");
    expect(replyStateOf([msg({ status: "FAILED" }), msg({ direction: "INBOUND" })])).toBe("unanswered");
  });

  test("sin mensajes: nada", () => {
    expect(replyStateOf([])).toBeNull();
    expect(replyStateOf([msg({ kind: "system" })])).toBeNull();
  });
});

describe("sendClearsUnread", () => {
  test("Dayana responde desde el CRM: queda leído", () => {
    expect(sendClearsUnread({ staffUserId: "s1" })).toBe(true);
    expect(sendClearsUnread({ staffUserId: "s1", source: "crm:perfil" })).toBe(true);
  });

  test("aprobar una propuesta: Dayana vio el chat", () => {
    expect(sendClearsUnread({ staffUserId: "s1", isAutoReply: true, source: "approval" })).toBe(true);
  });

  test("la IA, el saludo y los recordatorios no lo tocan", () => {
    expect(sendClearsUnread({ isAutoReply: true })).toBe(false);
    expect(sendClearsUnread({ isAutoReply: true, source: "recordatorio:evt" })).toBe(false);
    expect(sendClearsUnread({})).toBe(false);
  });

  test("un envío masivo tampoco, aunque lo lance Dayana", () => {
    expect(sendClearsUnread({ staffUserId: "s1", source: "bulk:abc" })).toBe(false);
  });

  test("reenviar algo que escribió la IA no cuenta como leído", () => {
    expect(sendClearsUnread({ staffUserId: "s1", isAutoReply: true, source: "resend:m1" })).toBe(false);
  });
});

describe("appointmentJustLinked (solo en el cambio)", () => {
  const now = at(0);
  const later = new Date(now.getTime() + 48 * 3600_000);
  const base = { phone: "573000000001", contactId: null, startsAt: later, now };

  test("cita nueva y futura con número: sí", () => {
    expect(appointmentJustLinked({ ...base, before: null })).toBe(true);
  });

  test("sin número ni contacto, o ya pasada: no", () => {
    expect(appointmentJustLinked({ ...base, phone: null, before: null })).toBe(false);
    expect(appointmentJustLinked({ ...base, startsAt: at(-60), before: null })).toBe(false);
  });

  test("la misma cita en otra pasada: no (si escribe otra vez, sigue pendiente)", () => {
    expect(appointmentJustLinked({ ...base, before: { phone: base.phone, status: "active", startsAt: later } })).toBe(false);
  });

  test("número recién puesto, cita que vuelve o que se mueve: sí", () => {
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
  // Un reloj adelantado no cubre mensajes del futuro.
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
        { direction: "OUTBOUND", sentAt: at(9) },
      ],
      start
    ).getTime()
  ).toBe(at(7).getTime());
  // Sin fechas (o sin mensajes suyos): el inicio de la vuelta.
  expect(lastInboundSeen([{ direction: "INBOUND" }], start).getTime()).toBe(start.getTime());
  expect(lastInboundSeen([{ direction: "OUTBOUND", sentAt: at(3) }], start).getTime()).toBe(start.getTime());
});

test("resolvedLabel", () => {
  expect(resolvedLabel("appointment")).toBe("por cita");
  expect(resolvedLabel("payment")).toBe("por pago");
  expect(resolvedLabel("manual")).toBe("a mano");
  expect(resolvedLabel(null)).toBe("a mano");
});
