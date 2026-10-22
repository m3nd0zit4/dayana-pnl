import { describe, expect, test } from "bun:test";

import {
  followUpDue,
  followUpText,
  nextFollowUp,
  payDateFrom,
  QUOTE_FOLLOW_UP_SOURCE,
  quotePromptLine,
  quoteSituation,
  stateFromReply,
  type QuoteLine,
} from "./quote-follow-up-rules";

const TZ = "Europe/Madrid";
const BOG = "America/Bogota";
const CONFIG = { firstAfterDays: 2, secondAfterDays: 4, max: 2, lookbackDays: 14 };

const at = (iso: string) => new Date(iso);
const dayana = (body: string, iso: string): QuoteLine => ({ direction: "OUTBOUND", body, sentAt: at(iso) });
const ai = (body: string, iso: string): QuoteLine => ({ direction: "OUTBOUND", body, sentAt: at(iso), isAutoReply: true });
const followUp = (iso: string, n: number): QuoteLine => ({
  direction: "OUTBOUND",
  body: "Hola Raquel, te bendigo 🙏 Dayana queda muy atenta…",
  sentAt: at(iso),
  isAutoReply: true,
  source: `${QUOTE_FOLLOW_UP_SOURCE}x:${n}`,
});
const person = (body: string, iso: string): QuoteLine => ({ direction: "INBOUND", body, sentAt: at(iso) });
const ymd = (d: Date | null, tz: string) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d) : null);

// Raquel Torres (+34), producción 19–22 oct.
const RAQUEL = [
  dayana("NOMBRE DE BANCO:BANCO UNIÓN – WESTERN UNION Envío directo a cuenta en Colombia Número de cuenta: 0000", "2026-10-19T15:35:00Z"),
  dayana("175 USD 580.000 COP", "2026-10-19T15:36:00Z"),
  dayana("PAQUETE DE TRES SESIONES PERSONALIZADAS 1.1", "2026-10-19T15:36:30Z"),
  person("Gracias bella , si te envío el Wester, y gracias de corazón 🙏🏼❤️", "2026-10-19T15:41:00Z"),
  dayana(
    "🎤 Hola, mi hermosa, te bendigo, quedo súper atenta para iniciar con tu proceso de reprogramación personalizado, tan pronto me envíes el comprobante de pago iniciamos, ¿okay, mi bella?",
    "2026-10-22T16:20:00Z"
  ),
  person(
    "🎤 Hola, Dayana, buenas tardes. Sí, estoy decidida a hacer este proceso contigo. Yo ya pedí que de Ecuador me envíen un Wester. Si esto me hubiera coincidido inicios de mes lo hubiera comenzado hoy ya. Tengo que esperar hasta la semana que viene, la otra semana que es fin de mes, para poder conseguir el dinerito y poderte enviar. Te enviaré el comprobante y empezamos.",
    "2026-10-22T16:24:00Z"
  ),
  dayana("🎤 Ok, mi bella, quedó súper atenta para poder iniciar. Te envío un abrazo de luz.", "2026-10-22T16:27:00Z"),
];

describe("payDateFrom", () => {
  // Miércoles 22 de octubre de 2026.
  const WED = at("2026-10-22T15:00:00Z");
  test.each([
    ["mañana te pago", "2026-10-23"],
    ["pasado mañana", "2026-10-24"],
    ["el viernes te envío el comprobante", "2026-10-23"],
    ["el lunes", "2026-10-26"],
    ["la otra semana", "2026-10-30"],
    ["la semana que viene", "2026-10-30"],
    ["a fin de mes", "2026-10-31"],
    ["cuando me paguen la quincena", "2026-10-31"],
    ["el próximo mes", "2026-11-05"],
    ["en 3 días", "2026-10-25"],
    ["en dos semanas", "2026-11-05"],
    ["el 30", "2026-10-30"],
    ["el 2 de noviembre", "2026-11-02"],
    ["hoy en la tarde", "2026-10-22"],
  ])("«%s» → %s", (text, expected) => {
    expect(ymd(payDateFrom(text, WED, BOG), BOG)).toBe(expected);
  });

  test("varias: la más lejana; «hoy» e «inicios de mes» de un «si hubiera» no cuentan (Raquel)", () => {
    expect(ymd(payDateFrom(RAQUEL[5].body!, RAQUEL[5].sentAt, TZ), TZ)).toBe("2026-10-31");
  });

  test("«en la mañana» no es mañana; sin fecha, null", () => {
    expect(payDateFrom("te escribo en la mañana", WED, BOG)).toBeNull();
    expect(payDateFrom("gracias, estamos en contacto", WED, BOG)).toBeNull();
  });
});

describe("stateFromReply", () => {
  const WED = at("2026-10-22T15:00:00Z");
  test.each([
    ["Ya te pagué, te mandé el comprobante", "pago_enviado"],
    ["No gracias, ya no me interesa", "no_quiere"],
    ["Ahorita no me alcanza", "sin_dinero"],
    ["No me alcanza ahora, pero a fin de mes sí", "pagara"],
    ["Sí, voy a pagar el viernes", "pagara"],
    ["Estoy decidida, apenas me paguen te envío", "pagara"],
    ["Lo voy a pensar y te aviso", "lo_piensa"],
    ["Lo hablo con mi esposo", "lo_piensa"],
    ["Muchísimas gracias si !! Estamos en contacto", "lo_piensa"],
  ])("«%s» → %s", (text, state) => {
    expect(stateFromReply(text, WED, BOG)?.state).toBe(state as never);
  });

  test.each(["Gracias 😊", "Igualmente", "Si gracias", "ok"])("«%s» no dice nada de pagar", (text) => {
    expect(stateFromReply(text, WED, BOG)).toBeNull();
  });
});

describe("quoteSituation", () => {
  test("Raquel: la cotización es el último mensaje de Dayana con cómo pagar (su audio); va a pagar ≈ 31 oct", () => {
    const s = quoteSituation(RAQUEL, { now: at("2026-10-22T17:00:00Z"), tz: TZ, lookbackDays: 14 })!;
    expect(s.quoteAt.toISOString()).toBe("2026-10-22T16:20:00.000Z");
    expect(s.state).toBe("pagara");
    expect(ymd(s.payBy, TZ)).toBe("2026-10-31");
    expect(s.dayanaLastAt.toISOString()).toBe("2026-10-22T16:27:00.000Z");
    expect(s.awaitingReply).toBe(false);
  });

  test("sin cotización de Dayana (solo la IA), o de hace más de 14 días: null", () => {
    expect(quoteSituation([ai("Te comparto los datos de Bancolombia: Número de cuenta 123", "2026-10-20T15:00:00Z")], { now: at("2026-10-22T15:00:00Z"), tz: BOG, lookbackDays: 14 })).toBeNull();
    expect(quoteSituation([dayana("https://www.dayanabeltran.com/pagar/p/therapy-3", "2026-10-01T15:00:00Z")], { now: at("2026-10-22T15:00:00Z"), tz: BOG, lookbackDays: 14 })).toBeNull();
  });

  test("cuenta los seguimientos ya enviados y lo que dijo después", () => {
    const lines = [
      dayana("https://www.dayanabeltran.com/pagar/p/therapy-3", "2026-10-12T15:00:00Z"),
      person("Gracias 🫂", "2026-10-12T15:10:00Z"),
      followUp("2026-10-14T15:00:00Z", 1),
    ];
    const s = quoteSituation(lines, { now: at("2026-10-16T15:00:00Z"), tz: BOG, lookbackDays: 14 })!;
    expect(s).toMatchObject({ state: "cotizada", sent: 1 });
    expect(s.lastSentAt?.toISOString()).toBe("2026-10-14T15:00:00.000Z");
  });
});

describe("nextFollowUp / followUpDue", () => {
  const quote = dayana("Tan pronto me envíes el comprobante de pago, agendamos día y hora que me digas", "2026-10-19T20:00:00Z");

  test("cotizada sin respuesta: el 1º dos días después", () => {
    const s = quoteSituation([quote, person("Gracias", "2026-10-19T20:05:00Z")], { now: at("2026-10-22T15:00:00Z"), tz: BOG, lookbackDays: 14 })!;
    expect(nextFollowUp(s, CONFIG, BOG)).toEqual({ at: at("2026-10-21T20:05:00Z"), kind: "first" });
    expect(followUpDue(s, CONFIG, { now: at("2026-10-22T15:00:00Z"), tz: BOG, lastOutboundAt: quote.sentAt })).toEqual({ kind: "first" });
  });

  test("Raquel: al día siguiente de la fecha que dijo, a las 10 a. m.; no antes", () => {
    const s = quoteSituation(RAQUEL, { now: at("2026-10-22T17:00:00Z"), tz: TZ, lookbackDays: 14 })!;
    const next = nextFollowUp(s, CONFIG, TZ)!;
    expect(next.kind).toBe("first");
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, dateStyle: "short", timeStyle: "short", hourCycle: "h23" }).format(next.at)).toBe("2026-11-01, 10:00");
    expect(followUpDue(s, CONFIG, { now: at("2026-10-28T10:00:00Z"), tz: TZ, lastOutboundAt: at("2026-10-22T16:27:00Z") })).toBeNull();
  });

  test("el 2º, cuatro días después del 1º si no contestó; después ninguno", () => {
    const lines = [quote, followUp("2026-10-21T15:00:00Z", 1)];
    const s = quoteSituation(lines, { now: at("2026-10-26T15:00:00Z"), tz: BOG, lookbackDays: 14 })!;
    expect(nextFollowUp(s, CONFIG, BOG)).toEqual({ at: at("2026-10-25T15:00:00Z"), kind: "second" });
    const done = quoteSituation([...lines, followUp("2026-10-25T15:00:00Z", 2)], { now: at("2026-10-30T15:00:00Z"), tz: BOG, lookbackDays: 14 })!;
    expect(nextFollowUp(done, CONFIG, BOG)).toBeNull();
  });

  test("no quiere o dice que ya pagó: ninguno", () => {
    const no = quoteSituation([quote, person("No gracias, ya no me interesa", "2026-10-20T15:00:00Z")], { now: at("2026-10-25T15:00:00Z"), tz: BOG, lookbackDays: 14 })!;
    expect(nextFollowUp(no, CONFIG, BOG)).toBeNull();
    const paid = quoteSituation([quote, person("Ya te pagué", "2026-10-20T15:00:00Z")], { now: at("2026-10-25T15:00:00Z"), tz: BOG, lookbackDays: 14 })!;
    expect(nextFollowUp(paid, CONFIG, BOG)).toBeNull();
  });

  test("lo está pensando: tres días; sin dinero: siete", () => {
    const think = quoteSituation([quote, person("Lo voy a pensar", "2026-10-20T15:00:00Z")], { now: at("2026-10-21T15:00:00Z"), tz: BOG, lookbackDays: 14 })!;
    expect(nextFollowUp(think, CONFIG, BOG)?.at).toEqual(at("2026-10-23T15:00:00Z"));
    const money = quoteSituation([quote, person("Ahorita no me alcanza", "2026-10-20T15:00:00Z")], { now: at("2026-10-21T15:00:00Z"), tz: BOG, lookbackDays: 14 })!;
    expect(nextFollowUp(money, CONFIG, BOG)?.at).toEqual(at("2026-10-27T15:00:00Z"));
  });

  test("Dayana le escribió: espera dos días desde su mensaje", () => {
    const s = quoteSituation([quote, person("Gracias", "2026-10-19T20:05:00Z"), dayana("Con gusto mi bella 🙏", "2026-10-21T14:00:00Z")], {
      now: at("2026-10-22T15:00:00Z"),
      tz: BOG,
      lookbackDays: 14,
    })!;
    expect(nextFollowUp(s, CONFIG, BOG)?.at).toEqual(at("2026-10-23T14:00:00Z"));
  });

  test("no sale si su último mensaje está sin contestar, si le escribieron hace menos de 24 h o de noche", () => {
    const waiting = quoteSituation([quote, person("¿Y cómo hago el pago?", "2026-10-22T14:00:00Z")], { now: at("2026-10-26T15:00:00Z"), tz: BOG, lookbackDays: 14 })!;
    expect(followUpDue(waiting, CONFIG, { now: at("2026-10-26T15:00:00Z"), tz: BOG, lastOutboundAt: quote.sentAt })).toBeNull();
    const s = quoteSituation([quote, person("Gracias", "2026-10-19T20:05:00Z")], { now: at("2026-10-22T15:00:00Z"), tz: BOG, lookbackDays: 14 })!;
    expect(followUpDue(s, CONFIG, { now: at("2026-10-22T15:00:00Z"), tz: BOG, lastOutboundAt: at("2026-10-22T01:00:00Z") })).toBeNull();
    // 11:30 p. m. en Bogotá.
    expect(followUpDue(s, CONFIG, { now: at("2026-10-23T04:30:00Z"), tz: BOG, lastOutboundAt: quote.sentAt })).toBeNull();
  });
});

describe("followUpText / quotePromptLine", () => {
  test("en la voz de la asistente, sin precios ni apodos", () => {
    const first = followUpText("first", "cotizada", "Fernando");
    expect(first).toBe(
      "Hola Fernando, te bendigo 🙏 Dayana queda muy atenta para iniciar tu proceso personalizado. ¿Cuándo te gustaría empezar? Tan pronto envíes el comprobante de pago por aquí, Dayana te agenda."
    );
    expect(followUpText("second", "pagara", null)).toStartWith("Hola 🙏 Te escribo de parte de Dayana");
    for (const state of ["cotizada", "pagara", "lo_piensa", "sin_dinero"] as const) {
      expect(followUpText("first", state, null)).not.toMatch(/\$|\d{2,}|querid|herm|bella|❤|💛/i);
    }
  });

  test("la línea del prompt dice en qué va y qué hacer si dice cuándo paga", () => {
    const s = quoteSituation(RAQUEL, { now: at("2026-10-22T17:00:00Z"), tz: TZ, lookbackDays: 14 })!;
    const line = quotePromptLine(s, TZ);
    expect(line).toContain("SEGUIMIENTO DEL CIERRE");
    expect(line).toContain("Va a pagar (≈ sábado, 31 de octubre)");
    expect(line).toContain("no escales");
  });
});
