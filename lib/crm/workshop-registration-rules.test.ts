import { describe, expect, test } from "bun:test";

import { fillVars } from "./whatsapp-outbound-plan";
import { STARTER_TEMPLATES } from "./whatsapp-templates";
import { META_BODY_MAX, templateBodyProblem, toMetaBody, utilityCategoryWarning } from "./whatsapp-template-rules";
import {
  isWorkshopChoice,
  isWorkshopOffer,
  workshopFollowLine,
  workshopLeadActive,
  workshopOutreachSource,
  WORKSHOP_CHOICE,
  type OpenWorkshop,
} from "./whatsapp-agent/workshop-interest";
import {
  isRegistrationOpen,
  pageVia,
  parsePageVia,
  parseRegistrationBody,
  REGISTRATION_STATE_LABEL,
  REGISTRATION_STATES,
  REGISTRATION_TEMPLATE_BODY,
  REGISTRATION_TEMPLATE_EXAMPLE,
  REGISTRATION_TEMPLATE_KEY,
  registrationClientKey,
  registrationSkip,
  registrationSourceDetail,
  registrationTemplateNotice,
  registrationWaStatus,
  registrationWhen,
  WORKSHOP_LINK_CTA,
  WORKSHOP_REGISTRATION_CAP,
  workshopRegistrationPath,
  workshopRegistrationTemplateVars,
  workshopRegistrationText,
  type RegistrationFacts,
} from "./workshop-registration-rules";

const WS: OpenWorkshop = {
  id: "ws1",
  title: "Tu Sanación con el Dinero",
  slug: "tu-sanacion-con-el-dinero",
  startsAt: new Date("2026-11-15T13:30:00Z"),
  startsAtHasTime: false,
  timezone: "America/Bogota",
  dateLabel: null,
  scheduleLabel: "8:30 a.m. – 4:30 p.m. · virtual",
  cardSummary: "Un día para mirar tu historia con el dinero",
  payUrl: "https://www.dayanabeltran.com/pagar/p/taller-tu-sanacion-con-el-dinero",
};

const OK: RegistrationFacts = {
  optedOut: false,
  phoneOk: true,
  paid: false,
  ignoredNumber: false,
  segment: "new_lead",
  stage: "nueva",
  segmentReview: false,
  category: null,
  categorySource: null,
  aiOff: false,
  aiBlocked: false,
  hasUpcomingCall: false,
  contactedToday: false,
};

/** Nada de precios, corazones, «te bendigo» ni formas con género (dueña: neutro). */
const assertVoice = (text: string) => {
  expect(text).not.toMatch(/\$|\bCOP\b|\bUSD\b|\d{2,3}[.,]\d{3}/);
  expect(text).not.toMatch(/💛|❤|♥|te bendigo|querida|linda|hermosa/i);
  expect(text).not.toMatch(/\b(inscrita|registrada|interesada|lista|bienvenida)\b/i);
  expect(text).not.toMatch(/https?:\/\//);
};

describe("dónde", () => {
  test("la página del registro y el botón de Enlaces con el texto de la dueña, en neutro", () => {
    expect(workshopRegistrationPath("tu-sanacion-con-el-dinero")).toBe("/taller-virtual/tu-sanacion-con-el-dinero/registro");
    expect(workshopRegistrationPath("a b")).toBe("/taller-virtual/a%20b/registro");
    expect(WORKSHOP_LINK_CTA).toEqual({ title: "Taller", note: "Si te interesa, regístrate" });
  });

  test("abierto: la regla del botón (OPEN, sin terminar, no pasó hace más de un día)", () => {
    const now = new Date("2026-10-28T15:00:00Z");
    const open = { status: "OPEN", endedAt: null, startsAt: new Date("2026-11-15T13:30:00Z") };
    expect(isRegistrationOpen(open, now)).toBe(true);
    expect(isRegistrationOpen({ ...open, startsAt: null }, now)).toBe(true);
    expect(isRegistrationOpen({ ...open, startsAt: new Date("2026-10-28T03:00:00Z") }, now)).toBe(true);
    expect(isRegistrationOpen({ ...open, startsAt: new Date("2026-10-26T15:00:00Z") }, now)).toBe(false);
    expect(isRegistrationOpen({ ...open, endedAt: now }, now)).toBe(false);
    expect(isRegistrationOpen({ ...open, status: "CLOSED" }, now)).toBe(false);
    expect(isRegistrationOpen({ ...open, status: "DRAFT" }, now)).toBe(false);
  });
});

describe("el formulario", () => {
  const base = { firstName: " Ana ", phone: "+573001234567", phoneCountry: "co", consentData: true };

  test("la trampa para bots va primero: «listo» sin guardar nada", () => {
    expect(parseRegistrationBody({ ...base, hp: "http://spam" })).toEqual({ ok: false, error: "honeypot" });
    expect(parseRegistrationBody({ hp: "x" })).toEqual({ ok: false, error: "honeypot" });
  });

  test("nombre y WhatsApp obligatorios; el permiso de datos también; el correo, si viene, válido", () => {
    expect(parseRegistrationBody({ ...base, firstName: "  " })).toEqual({ ok: false, error: "missing_fields" });
    expect(parseRegistrationBody({ ...base, phone: "" })).toEqual({ ok: false, error: "missing_fields" });
    expect(parseRegistrationBody({ ...base, consentData: false })).toEqual({ ok: false, error: "consent_required" });
    expect(parseRegistrationBody({ ...base, consentData: "true" })).toEqual({ ok: false, error: "consent_required" });
    expect(parseRegistrationBody({ ...base, email: "ana@" })).toEqual({ ok: false, error: "invalid_email" });
    expect(parseRegistrationBody(null)).toEqual({ ok: false, error: "missing_fields" });
  });

  test("lo limpia: espacios, correo en minúsculas, país en mayúsculas, el segundo permiso solo si es true", () => {
    const r = parseRegistrationBody({ ...base, lastName: "  Pérez ", email: " Ana@Correo.COM ", consentMarketing: true, ref: "Enlaces" });
    expect(r).toEqual({
      ok: true,
      value: {
        firstName: "Ana",
        lastName: "Pérez",
        email: "ana@correo.com",
        phone: "+573001234567",
        phoneCountry: "CO",
        consentMarketing: true,
        ref: "enlaces",
      },
    });
    const plain = parseRegistrationBody({ ...base, consentMarketing: "sí", ref: "<script>", phoneCountry: "Colombia" });
    expect(plain.ok && plain.value).toMatchObject({ email: null, lastName: null, consentMarketing: false, ref: null, phoneCountry: null });
  });

  test("el detalle de origen del contacto", () => {
    expect(registrationSourceDetail("Tu  Sanación con el Dinero", "enlaces")).toBe("Interés en taller: Tu Sanación con el Dinero (Enlaces)");
    expect(registrationSourceDetail("Taller", null)).toBe("Interés en taller: Taller");
  });
});

describe("el WhatsApp", () => {
  test("la plantilla: de Utilidad (dueña: «que no sea de marketing ya que la persona aceptó»), sin palabras de venta, una línea, con la pregunta del cupo o la llamada", () => {
    expect(templateBodyProblem(REGISTRATION_TEMPLATE_BODY)).toBeNull();
    expect(toMetaBody(REGISTRATION_TEMPLATE_BODY).varNames).toEqual(["nombre", "taller", "fecha"]);
    expect(REGISTRATION_TEMPLATE_BODY).toContain("Recibimos tu registro para el taller {{taller}} ({{fecha}}).");
    expect(REGISTRATION_TEMPLATE_BODY).toContain("Para completar tu inscripción");
    expect(REGISTRATION_TEMPLATE_BODY.endsWith("Responde a este mensaje y te ayudo.")).toBe(true);
    expect(REGISTRATION_TEMPLATE_BODY).not.toContain("\n");
    expect(utilityCategoryWarning("UTILITY", REGISTRATION_TEMPLATE_BODY)).toBeNull();
    expect(REGISTRATION_TEMPLATE_BODY).not.toMatch(/gratis|aprovecha|oferta|descuento|limitad|no te lo pierdas|🙏|😊|✨/i);
    // Su respuesta sigue el flujo de la IA: es la pregunta del cupo o la llamada.
    expect(isWorkshopChoice(REGISTRATION_TEMPLATE_BODY)).toBe(true);
    assertVoice(REGISTRATION_TEMPLATE_BODY);
    const starter = STARTER_TEMPLATES.find((t) => t.key === REGISTRATION_TEMPLATE_KEY);
    expect(starter?.category).toBe("UTILITY");
    expect(starter?.body).toBe(REGISTRATION_TEMPLATE_BODY);
    for (const v of toMetaBody(REGISTRATION_TEMPLATE_BODY).varNames) expect(REGISTRATION_TEMPLATE_EXAMPLE[v]).toBeTruthy();
    // El nombre en Meta: minúsculas y guion bajo.
    expect(REGISTRATION_TEMPLATE_KEY).toMatch(/^[a-z0-9_]{1,60}$/);
  });

  test("dentro de las 24 h: lo mismo que la plantilla (registro, cuándo, pago o llamada), y la pregunta; con su nombre si lo escribió", () => {
    const t = workshopRegistrationText(WS, { firstName: "Ana" });
    expect(t.startsWith("Hola Ana 🙏 Soy la asistente de Dayana Beltrán.")).toBe(true);
    expect(t).toContain("Recibimos tu registro para el taller «Tu Sanación con el Dinero» (domingo 15 de noviembre, 8:30 a. m. – 4:30 p. m., virtual, hora de Colombia).");
    expect(t).toContain(
      "Para completar tu inscripción puedes hacer el pago en el enlace de inscripción o agendar primero una llamada gratis con Dayana, donde te explica el taller y su valor."
    );
    expect(t.endsWith(`\n\n${WORKSHOP_CHOICE}`)).toBe(true);
    assertVoice(t);
    expect(workshopRegistrationText(WS, { firstName: null }).startsWith("Hola 🙏 Soy la asistente")).toBe(true);
  });

  test("lo que contesta sigue el flujo del taller: es la oferta, la pregunta del cupo y lleva su source", () => {
    const now = new Date("2026-10-28T15:00:00Z");
    const body = workshopRegistrationText(WS, { firstName: "Ana" });
    const ours = { direction: "OUTBOUND", body, source: workshopOutreachSource(WS), sentAt: now };
    expect(isWorkshopChoice(body)).toBe(true);
    expect(isWorkshopOffer(ours, WS)).toBe(true);
    const lines = [ours, { direction: "INBOUND", body: "Quiero separar mi cupo", sentAt: new Date(now.getTime() + 60_000) }];
    expect(workshopLeadActive(lines, WS, now.getTime() + 2 * 60_000)).toBe(true);
    // Tres días después, todavía; más, ya no.
    expect(workshopLeadActive([ours], WS, now.getTime() + 71 * 3600_000)).toBe(true);
    expect(workshopLeadActive([ours], WS, now.getTime() + 73 * 3600_000)).toBe(false);
    expect(workshopFollowLine(lines, WS, now.getTime() + 2 * 60_000)).toContain("le preguntamos si quiere separar su cupo");
    // La plantilla también.
    const tpl = fillVars(REGISTRATION_TEMPLATE_BODY, workshopRegistrationTemplateVars(WS, { firstName: "Ana" }));
    expect(isWorkshopOffer({ direction: "OUTBOUND", body: tpl, source: workshopOutreachSource(WS) }, WS)).toBe(true);
    expect(workshopFollowLine([{ direction: "OUTBOUND", body: tpl, sentAt: now }], WS, now.getTime())).toContain("le preguntamos si quiere separar su cupo");
  });

  test("sin precio (sin enlace de pago): la llamada para inscribirse, sin hablar del enlace", () => {
    const t = workshopRegistrationText({ ...WS, payUrl: null }, { firstName: null });
    expect(t).not.toMatch(/enlace|cupo ya/);
    expect(t).toContain("primero tienes una llamada gratis con Dayana");
    expect(t.endsWith("¿Quieres que te la separe?")).toBe(true);
  });

  test("las variables de la plantilla: sin nombre «😊», título largo cortado, sin fecha «fecha por confirmar»", () => {
    expect(workshopRegistrationTemplateVars(WS, { firstName: "Ana" })).toEqual({
      nombre: "Ana",
      taller: "«Tu Sanación con el Dinero»",
      fecha: "domingo 15 de noviembre, 8:30 a. m. – 4:30 p. m., virtual, hora de Colombia",
    });
    const long = workshopRegistrationTemplateVars({ ...WS, title: "x".repeat(200), startsAt: null, scheduleLabel: null }, { firstName: null });
    expect(long.nombre).toBe("😊");
    expect(long.taller.length).toBeLessThanOrEqual(93);
    expect(long.taller.endsWith("…»")).toBe(true);
    expect(long.fecha).toBe("fecha por confirmar");
    expect(fillVars(REGISTRATION_TEMPLATE_BODY, long).length).toBeLessThanOrEqual(META_BODY_MAX);
    expect(registrationWhen({ ...WS, startsAt: null, dateLabel: "Sábado 21 de noviembre", scheduleLabel: null })).toBe(
      "Sábado 21 de noviembre, hora de Colombia"
    );
  });

  test("una por chat y edición; tope por edición como el de los eventos", () => {
    expect(registrationClientKey("ed1", "conv1")).toBe("taller-registro:ed1:conv1");
    expect(WORKSHOP_REGISTRATION_CAP).toEqual({ perHour: 40, perDay: 300 });
  });
});

describe("la marca en «Interesadas» (offered_via)", () => {
  test("pagina:<estado> se lee de vuelta; lo de antes (text, template, null) no es de la página", () => {
    for (const s of REGISTRATION_STATES) expect(parsePageVia(pageVia(s))).toEqual({ page: true, state: s });
    expect(parsePageVia("text")).toEqual({ page: false });
    expect(parsePageVia("template")).toEqual({ page: false });
    expect(parsePageVia(null)).toEqual({ page: false });
    expect(parsePageVia("pagina:otra-cosa")).toEqual({ page: true, state: "fallo" });
  });
});

describe("cuándo no sale", () => {
  test("a quien puede recibirlo, sale", () => {
    expect(registrationSkip(OK)).toBeNull();
    expect(registrationSkip({ ...OK, stage: "tuvo_llamada", segment: "after_call" })).toBeNull();
    // La IA la llamó «cliente», pero no Dayana: no es clienta (dueña, 14-oct).
    expect(registrationSkip({ ...OK, category: "cliente", categorySource: "ai" })).toBeNull();
  });

  test("baja, sin número, ya pagó, personal, clienta, por revisar, la IA no atiende, con llamada, ya le escribimos hoy", () => {
    expect(registrationSkip({ ...OK, optedOut: true, paid: true })).toBe("baja");
    expect(registrationSkip({ ...OK, phoneOk: false })).toBe("sin_numero");
    expect(registrationSkip({ ...OK, paid: true, segment: "client" })).toBe("pagado");
    expect(registrationSkip({ ...OK, ignoredNumber: true })).toBe("personal");
    expect(registrationSkip({ ...OK, segment: "ignored" })).toBe("personal");
    expect(registrationSkip({ ...OK, stage: "personal" })).toBe("personal");
    expect(registrationSkip({ ...OK, category: "equipo", categorySource: "manual" })).toBe("personal");
    expect(registrationSkip({ ...OK, segment: "client", stage: "clienta_activa" })).toBe("clienta");
    expect(registrationSkip({ ...OK, stage: "clienta_pasada" })).toBe("clienta");
    expect(registrationSkip({ ...OK, category: "cliente", categorySource: "manual" })).toBe("clienta");
    expect(registrationSkip({ ...OK, segmentReview: true })).toBe("revisar");
    expect(registrationSkip({ ...OK, stage: "por_revisar" })).toBe("revisar");
    expect(registrationSkip({ ...OK, aiOff: true })).toBe("ia");
    expect(registrationSkip({ ...OK, aiBlocked: true })).toBe("ia");
    expect(registrationSkip({ ...OK, hasUpcomingCall: true })).toBe("llamada");
    expect(registrationSkip({ ...OK, contactedToday: true })).toBe("ya_escrito");
  });
});

describe("lo que ve Dayana", () => {
  const now = new Date("2026-10-28T15:00:00Z");
  const at = new Date("2026-10-28T14:00:00Z");

  test("el mensaje manda: enviado, entregado, leído; WhatsApp avisó que no llegó, con su motivo", () => {
    expect(registrationWaStatus({ state: "text", message: { status: "READ", sentAt: at, failedReason: null }, updatedAt: at, now })).toMatchObject({
      kind: "sent",
      label: "WhatsApp enviado · leído",
      sentAt: at,
      via: "text",
    });
    expect(registrationWaStatus({ state: "template", message: { status: "DELIVERED", sentAt: at, failedReason: null }, updatedAt: at, now }).label).toBe(
      "WhatsApp enviado (plantilla) · entregado"
    );
    expect(
      registrationWaStatus({ state: "text", message: { status: "FAILED", sentAt: at, failedReason: "Número no tiene WhatsApp (código 131026)" }, updatedAt: at, now })
    ).toMatchObject({ kind: "failed", label: "WhatsApp no llegó", detail: "Número no tiene WhatsApp (código 131026)" });
  });

  test("sin mensaje: esperando la plantilla, por qué no salió, o un envío que se cortó", () => {
    const plantilla = registrationWaStatus({ state: "plantilla", message: null, updatedAt: at, now });
    expect(plantilla).toMatchObject({ kind: "pending", label: "WhatsApp: espera la plantilla" });
    expect(plantilla.detail).toContain("Meta todavía no aprueba la plantilla");
    expect(registrationWaStatus({ state: "baja", message: null, updatedAt: at, now })).toMatchObject({
      kind: "skipped",
      label: "WhatsApp no enviado",
      detail: "Pidió no recibir WhatsApp.",
    });
    expect(registrationWaStatus({ state: "tope", message: null, updatedAt: at, now }).detail).toContain("40 por hora");
    expect(registrationWaStatus({ state: "enviando", message: null, updatedAt: new Date(now.getTime() - 60_000), now }).kind).toBe("pending");
    expect(registrationWaStatus({ state: "enviando", message: null, updatedAt: at, now })).toMatchObject({ kind: "failed", label: "WhatsApp: no se sabe si salió" });
    expect(registrationWaStatus({ state: "fallo", message: null, updatedAt: at, now }).kind).toBe("failed");
    // Meta la aprobó como Marketing: se dice claro y no sale sola.
    const mkt = registrationWaStatus({ state: "marketing", message: null, updatedAt: at, now });
    expect(mkt).toMatchObject({ kind: "pending", label: "WhatsApp: Meta pasó la plantilla a Marketing" });
    expect(mkt.detail).toContain("como Marketing, no como Utilidad: no se envía sola");
  });

  test("la plantilla en Meta, en la cabecera: sin mandar, en revisión, Utilidad, pasada a Marketing, rechazada", () => {
    expect(registrationTemplateNotice(null)).toMatchObject({ tone: "info" });
    expect(registrationTemplateNotice({ status: "PENDING", category: "UTILITY" }).text).toContain("en revisión de Meta");
    expect(registrationTemplateNotice({ status: "APPROVED", category: "UTILITY" })).toMatchObject({ tone: "ok" });
    const mkt = registrationTemplateNotice({ status: "APPROVED", category: "MARKETING" });
    expect(mkt.tone).toBe("warn");
    expect(mkt.text).toContain("Meta la aprobó como Marketing, no como Utilidad. No se envía sola");
    expect(registrationTemplateNotice({ status: "REJECTED", category: "UTILITY" })).toMatchObject({ tone: "warn" });
  });

  test("cada motivo tiene su explicación", () => {
    for (const s of REGISTRATION_STATES) {
      if (s === "text" || s === "template") continue;
      expect(REGISTRATION_STATE_LABEL[s]).toBeTruthy();
    }
  });
});
