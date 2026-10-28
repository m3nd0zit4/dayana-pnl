import { describe, expect, test } from "bun:test";

import { templateBodyProblem, toMetaBody } from "./whatsapp-template-rules";
import { fillVars } from "./whatsapp-outbound-plan";
import {
  isWorkshopChoice,
  isWorkshopOffer,
  workshopFlowActive,
  workshopFollowLine,
  workshopLeadActive,
  workshopOutreachSource,
  WORKSHOP_CHOICE,
  type OpenWorkshop,
} from "./whatsapp-agent/workshop-interest";
import {
  countExclusions,
  declinesInvite,
  INVITE_TEMPLATE_BODY,
  INVITE_TEMPLATE_EXAMPLE,
  inviteBlockedReason,
  inviteClientKey,
  inviteEventMention,
  inviteExclusion,
  inviteWindowStart,
  workshopInviteTemplateVars,
  workshopInviteText,
  type InviteFacts,
} from "./workshop-invite-rules";

const WS: OpenWorkshop = {
  id: "ws1",
  title: "Sana Tu Relación con el Dinero",
  slug: "tu-sanacion-con-el-dinero",
  startsAt: new Date("2026-11-15T13:30:00Z"),
  startsAtHasTime: false,
  timezone: "America/Bogota",
  dateLabel: null,
  scheduleLabel: "8:30 a.m. – 4:30 p.m. · virtual",
  cardSummary: "Un día para mirar tu historia con el dinero y soltar lo que te frena",
  payUrl: "https://www.dayanabeltran.com/pagar/p/taller-tu-sanacion-con-el-dinero",
};

const OK: InviteFacts = {
  consentMarketing: true,
  optedOut: false,
  phoneOk: true,
  paidWorkshop: false,
  segment: "returning_lead",
  stage: "conversando",
  segmentReview: false,
  category: "interesada",
  categorySource: "ai",
  ignoredNumber: false,
  alreadyInvited: false,
  inInterests: false,
  hasUpcomingCall: false,
  aiBlocked: false,
};

describe("a quién se invita", () => {
  test("con el consentimiento de novedades, sin nada más: sí", () => {
    expect(inviteExclusion(OK)).toBeNull();
  });

  test("sin el consentimiento de talleres (solo el de datos del formulario): no", () => {
    expect(inviteExclusion({ ...OK, consentMarketing: false })).toBe("no_consent");
    // Es lo primero: aunque además sea clienta o ya pagara, cuenta como sin consentimiento.
    expect(inviteExclusion({ ...OK, consentMarketing: false, paidWorkshop: true, segment: "client" })).toBe("no_consent");
  });

  test("pidió la baja, sin número, ya pagó el taller", () => {
    expect(inviteExclusion({ ...OK, optedOut: true })).toBe("opted_out");
    expect(inviteExclusion({ ...OK, phoneOk: false })).toBe("no_phone");
    expect(inviteExclusion({ ...OK, paidWorkshop: true })).toBe("paid");
  });

  test("personal, negocio, equipo o número ignorado: no", () => {
    expect(inviteExclusion({ ...OK, ignoredNumber: true })).toBe("personal");
    expect(inviteExclusion({ ...OK, segment: "ignored", stage: "personal" })).toBe("personal");
    for (const category of ["personal", "negocio", "equipo"]) expect(inviteExclusion({ ...OK, category })).toBe("personal");
  });

  test("clienta (pagó y Dayana lo confirmó) o por revisar: no; la etiqueta «cliente» de la IA sola, sí", () => {
    expect(inviteExclusion({ ...OK, segment: "client", stage: "clienta_activa" })).toBe("client");
    expect(inviteExclusion({ ...OK, segment: "client", stage: "clienta_pasada" })).toBe("client");
    expect(inviteExclusion({ ...OK, category: "cliente", categorySource: "manual" })).toBe("client");
    expect(inviteExclusion({ ...OK, segment: "client", segmentReview: true, stage: "por_revisar" })).toBe("review");
    expect(inviteExclusion({ ...OK, category: "cliente", categorySource: "ai" })).toBeNull();
  });

  test("ya tuvo su llamada gratis o no contestó: sí (el taller es otra cosa)", () => {
    expect(inviteExclusion({ ...OK, segment: "after_call", stage: "tuvo_llamada" })).toBeNull();
    expect(inviteExclusion({ ...OK, stage: "no_contesto" })).toBeNull();
  });

  test("ya invitada, ya en Interesadas, con llamada, o la IA no atiende el chat: no", () => {
    expect(inviteExclusion({ ...OK, alreadyInvited: true })).toBe("already_invited");
    expect(inviteExclusion({ ...OK, inInterests: true })).toBe("interested");
    expect(inviteExclusion({ ...OK, hasUpcomingCall: true })).toBe("has_call");
    expect(inviteExclusion({ ...OK, aiBlocked: true })).toBe("ai_blocked");
  });

  test("el recuento por motivo, en orden y sin ceros", () => {
    const rows = countExclusions(["no_consent", null, "paid", "no_consent", null]);
    expect(rows.map((r) => [r.reason, r.count])).toEqual([
      ["no_consent", 2],
      ["paid", 1],
    ]);
    expect(rows[0].label).toContain("No aceptaron recibir información de talleres");
  });

  test("la ventana: eventos de los últimos 60 días", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    expect(inviteWindowStart(now).toISOString()).toBe("2026-08-29T12:00:00.000Z");
  });

  test("una clave por persona y edición", () => {
    expect(inviteClientKey("ws1", "c1")).toBe("taller-invita:ws1:c1");
    expect(inviteClientKey("ws2", "c1")).not.toBe(inviteClientKey("ws1", "c1"));
  });

  test("sin precio o sin fecha no se invita", () => {
    expect(inviteBlockedReason(WS)).toBeNull();
    expect(inviteBlockedReason({ ...WS, payUrl: null })).toContain("precio");
    expect(inviteBlockedReason({ ...WS, startsAt: null, dateLabel: null })).toContain("fecha");
    expect(inviteBlockedReason({ ...WS, startsAt: null, dateLabel: "15 de noviembre" })).toBeNull();
  });
});

describe("el mensaje", () => {
  const webinar = { headline: "Webinar Gratuito", eventLabel: "Webinar Gratuito", startsAt: new Date("2026-10-25T14:30:00Z") };
  const masterclass = {
    headline: "Reprograma tu mente con PNL",
    eventLabel: "Masterclass Gratuita",
    startsAt: new Date("2026-10-04T14:30:00Z"),
  };

  test("el evento, sin artículo con género", () => {
    expect(inviteEventMention(webinar)).toBe("su webinar gratuito del 25 de octubre");
    expect(inviteEventMention(masterclass)).toBe("su masterclass gratuita «Reprograma tu mente con PNL»");
    expect(inviteEventMention(null)).toBe("uno de sus eventos gratuitos");
  });

  test("dice que es de pago, qué y cuándo, y la pregunta del cupo o la llamada; sin valor ni enlace", () => {
    const text = workshopInviteText(WS, { firstName: "Ana", event: webinar });
    expect(text.startsWith("Hola Ana 🙏 Soy la asistente de Dayana Beltrán.")).toBe(true);
    expect(text).toContain("te inscribiste en su webinar gratuito del 25 de octubre y aceptaste recibir información de sus talleres");
    expect(text).toContain("abrió el taller «Sana Tu Relación con el Dinero»: es el domingo 15 de noviembre, 8:30 a. m. – 4:30 p. m., virtual (hora de Colombia).");
    expect(text).toContain("Un día para mirar tu historia con el dinero y soltar lo que te frena.");
    expect(text).toContain("Es un taller de pago.");
    expect(text.endsWith(WORKSHOP_CHOICE)).toBe(true);
    expect(text).not.toMatch(/https?:|\$|COP|USD|\d{2,3}\.\d{3}/);
    expect(isWorkshopChoice(text)).toBe(true);
  });

  test("sin nombre seguro, sin nombre; sin corazones ni palabras con género", () => {
    const text = workshopInviteText(WS, { firstName: null, event: null });
    expect(text.startsWith("Hola 🙏 Soy la asistente")).toBe(true);
    expect(text).not.toMatch(/💛|❤|♥|querida|bella|hermosa|linda|inscrita|interesada|bienvenida/i);
  });

  test("un resumen largo no entra (no es un folleto)", () => {
    const text = workshopInviteText({ ...WS, cardSummary: "x ".repeat(200) }, { firstName: null, event: null });
    expect(text).not.toContain("x x x");
  });

  test("la plantilla: reglas de Meta, una pregunta de cupo o llamada, de pago y sin corazones", () => {
    expect(templateBodyProblem(INVITE_TEMPLATE_BODY)).toBeNull();
    expect(toMetaBody(INVITE_TEMPLATE_BODY).varNames).toEqual(["nombre", "taller", "fecha"]);
    const filled = fillVars(INVITE_TEMPLATE_BODY, INVITE_TEMPLATE_EXAMPLE);
    expect(isWorkshopChoice(filled)).toBe(true);
    expect(filled).toContain("Es un taller de pago.");
    expect(INVITE_TEMPLATE_BODY).not.toMatch(/💛|❤|te bendigo|retomar/);
  });

  test("las variables: una línea, sin nombre que no sea seguro", () => {
    const vars = workshopInviteTemplateVars({ ...WS, title: "Sana  Tu\nRelación con el Dinero" }, { firstName: null });
    expect(vars).toEqual({
      nombre: "😊",
      taller: "«Sana Tu Relación con el Dinero»",
      fecha: "domingo 15 de noviembre, 8:30 a. m. – 4:30 p. m., virtual (hora de Colombia)",
    });
    expect(Object.values(vars).some((v) => /\n/.test(v))).toBe(false);
    expect(workshopInviteTemplateVars(WS, { firstName: "Ana" }).nombre).toBe("Ana");
  });
});

describe("su respuesta sigue lo del taller", () => {
  const now = new Date("2026-10-28T15:00:00Z").getTime();
  const sent = new Date(now - 26 * 3600_000);
  const invite = {
    direction: "OUTBOUND",
    body: workshopInviteText(WS, { firstName: null, event: null }),
    sentAt: sent,
    source: workshopOutreachSource(WS),
  };

  test("su «sí, quiero separar mi cupo» es del taller (3 días), con la pregunta del cupo ya hecha", () => {
    const lines = [invite, { direction: "INBOUND", body: "Sí, quiero separar mi cupo", sentAt: new Date(now - 60_000), source: null }];
    expect(isWorkshopOffer(invite, WS)).toBe(true);
    expect(workshopLeadActive(lines, WS, now)).toBe(true);
    expect(workshopFlowActive(lines, WS, now)).toBe(true);
    expect(workshopFollowLine(lines, WS, now)).toContain("send_workshop_link");
  });

  test("la plantilla también cuenta (su texto lleva la pregunta del cupo)", () => {
    const tpl = { ...invite, body: fillVars(INVITE_TEMPLATE_BODY, INVITE_TEMPLATE_EXAMPLE) };
    const lines = [tpl, { direction: "INBOUND", body: "La llamada", sentAt: new Date(now - 60_000), source: null }];
    expect(workshopLeadActive(lines, WS, now)).toBe(true);
    expect(workshopFollowLine(lines, WS, now)).toContain("le preguntamos si quiere separar su cupo");
  });

  test("después de 3 días ya no", () => {
    const old = { ...invite, sentAt: new Date(now - 80 * 3600_000) };
    expect(workshopLeadActive([old, { direction: "INBOUND", body: "Hola", sentAt: new Date(now), source: null }], WS, now)).toBe(false);
  });

  test("«no me interesa» y la baja son un no; una pregunta no", () => {
    for (const no of ["No me interesa", "no gracias", "No, gracias 🙏", "Por ahora no", "baja", "no me interesa, gracias"]) {
      expect(declinesInvite(no)).toBe(true);
    }
    for (const yes of ["no puedo ese día, ¿hay otro?", "¿Cuánto cuesta?", "Sí", "La llamada", "no sé, cuéntame más"]) {
      expect(declinesInvite(yes)).toBe(false);
    }
  });
});
