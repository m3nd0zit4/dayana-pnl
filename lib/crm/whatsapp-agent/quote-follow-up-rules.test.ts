import { describe, expect, test } from "bun:test";

import {
  asksHowToPay,
  followUpDue,
  followUpText,
  isQuote,
  isQuoteLine,
  nextFollowUp,
  payDateFrom,
  QUOTE_FOLLOW_UP_SOURCE,
  quoteHow,
  quoteHowText,
  quotePayReply,
  quotePromptLine,
  quoteSituation,
  stateFromReply,
  withQuoteReminder,
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
    // Revisión 22-oct (Carmen: «ya quedamos para la primer semana de noviembre»).
    ["ya quedamos para la primer semana de noviembre", "2026-11-06"],
    ["la primera semana del próximo mes", "2026-11-06"],
    ["la primera semana del mes", "2026-11-06"],
    ["la segunda semana de noviembre", "2026-11-13"],
    ["a mediados de noviembre", "2026-11-15"],
    ["a finales de noviembre", "2026-11-30"],
    ["a principios de diciembre", "2026-12-05"],
    ["en noviembre te pago", "2026-11-05"],
    ["la semanita que viene", "2026-10-30"],
    ["a mediados de mes", "2026-11-15"],
  ])("«%s» → %s", (text, expected) => {
    expect(ymd(payDateFrom(text, WED, BOG), BOG)).toBe(expected);
  });

  test("varias: la más lejana; «hoy» e «inicios de mes» de un «si hubiera» no cuentan (Raquel)", () => {
    expect(ymd(payDateFrom(RAQUEL[5].body!, RAQUEL[5].sentAt, TZ), TZ)).toBe("2026-10-31");
  });

  test("«del mes» ya pasado es el del mes que viene; «desde enero» habla de lo que pasó (revisión 22-oct)", () => {
    const NOV7 = at("2026-11-07T15:00:00Z");
    expect(ymd(payDateFrom("la primera semana del mes te pago", NOV7, BOG), BOG)).toBe("2026-12-04");
    expect(ymd(payDateFrom("te pago la segunda semana del mes", at("2026-11-14T15:00:00Z"), BOG), BOG)).toBe("2026-12-11");
    expect(payDateFrom("desde enero estoy sin trabajo", at("2026-11-25T15:00:00Z"), BOG)).toBeNull();
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

  // Revisión 22-oct.
  test.each([
    ["Hoy no tengo plata", "sin_dinero"],
    ["Lo pienso y te aviso mañana", "lo_piensa"],
    ["Te mande el comprobante cuando pague", "pagara"],
    ["No gracias por el recordatorio, pago el viernes", "pagara"],
    ["Si ella me lo y ya quedamos para la primer semana de noviembre", "pagara"],
    // Revisión 22-oct: un «no» o «lo pienso» con una fecha que no es para pagar.
    ["No me interesa, gracias. El lunes empiezo a trabajar", "no_quiere"],
    ["Ya no quiero iniciar el proceso, gracias. Quizás en diciembre", "no_quiere"],
    ["No me interesa, mi hija empieza el colegio en enero", "no_quiere"],
    ["Quedamos así, mañana te confirmo", "lo_piensa"],
    ["Desde enero estoy sin trabajo, no me alcanza", "sin_dinero"],
    ["Mañana inicio el trabajo nuevo, después te aviso", "lo_piensa"],
    ["Empiezo el lunes, te mando el comprobante", "pagara"],
  ])("«%s» → %s (no una promesa de hoy o mañana, ni un pago que aún no hizo)", (text, state) => {
    expect(stateFromReply(text, WED, BOG)?.state).toBe(state as never);
  });

  test.each(["Gracias 😊", "Igualmente", "Si gracias", "ok", "Mañana inicio un trabajo nuevo, ahí te cuento", "El lunes inicio la quimio, no sé cómo voy a estar"])("«%s» no dice nada de pagar", (text) => {
    expect(stateFromReply(text, WED, BOG)).toBeNull();
  });
});

describe("isQuote: qué cuenta como cotización", () => {
  test("enlace, datos de cualquier banco, valor de una sesión o «mándame el comprobante»", () => {
    expect(isQuote("https://www.dayanabeltran.com/pagar/p/therapy-6")).toBe(true);
    expect(isQuote("NOMBRE DE BANCO:BANCO UNIÓN – WESTERN UNION\nNúmero de cuenta: 0173")).toBe(true);
    expect(isQuote("Bancolombia ahorros 15460415745 a nombre de Diana")).toBe(true);
    expect(isQuote("Mi Zelle es pagos@ejemplo.com")).toBe(true);
    expect(isQuote("Yape 987 654 321")).toBe(true);
    expect(isQuote("🎤 Hola mi hermosa, si deseas pagar una sesión por aparte está en $90. Si deseas paquete de tres te quedan 175.")).toBe(true);
    expect(isQuote("Tan pronto me envíes el comprobante agendamos")).toBe(true);
    // Mariantonia (10-oct): el valor de su proceso, aunque nombre la llamada.
    expect(
      isQuote("Mi hermosa en la llamada. Te digo cómo es el proceso personalizado de Reprogramacion 1.1 de una hora virtual tiene la inversión de 190,000 pesos")
    ).toBe(true);
  });

  test("el precio de un curso o un evento, o lo que cuesta antes de la llamada, no (Patricia, Montoya)", () => {
    expect(
      isQuote("🎤 Tenemos un curso los días miércoles y viernes, acá vas a tener capacitación y entrenamiento en horas de la noche, esa está en $60 si quisieses aprender")
    ).toBe(false);
    expect(isQuote("El taller del sábado cuesta $50.000")).toBe(false);
    expect(isQuote("🎤 Bueno, la llamada es básicamente para poder sacar un diagnóstico. Una sola sesión está en 190.000 pesos, dura una hora. La llamada es para eso.")).toBe(
      false
    );
    // Con los datos para pagar sí es cómo pagar.
    expect(isQuote("Mi Nequi es 3105833188 para el curso")).toBe(true);
    // Nombrar PayPal no salta el filtro del curso (revisión 22-oct).
    expect(isQuote("🎤 El curso está en $60, lo puedes pagar por PayPal desde la página")).toBe(false);
  });

  test("de la asistente, solo el bloque que pega el código (enlace o datos con su número)", () => {
    const ai2 = (body: string): QuoteLine => ({ direction: "OUTBOUND", body, sentAt: at("2026-10-20T15:00:00Z"), isAutoReply: true });
    expect(isQuoteLine(ai2("Claro, te comparto los datos para el pago:\n\nNequi 3001234567 a nombre de Prueba Uno"))).toBe(true);
    expect(isQuoteLine(ai2("Puedes hacer el pago por el enlace que te envió Dayana.\n\nhttps://www.dayanabeltran.com/pagar/p/therapy-3"))).toBe(true);
    expect(isQuoteLine(ai2("Cuando hagas el pago por Nequi, me mandas el comprobante por aquí"))).toBe(false);
    expect(isQuoteLine(ai2("¿Prefieres pagar por enlace con tarjeta o PayPal, o por transferencia a Bancolombia o Nequi?"))).toBe(false);
    expect(isQuoteLine(ai2("Claro, el lunes 2026-10-26 Dayana te escribe por Nequi"))).toBe(false);
    expect(isQuoteLine(ai2("Te comparto los datos:\n\nPayPal: pagos.dayana@ejemplo.com"))).toBe(true);
  });
});

describe("quoteHow: de qué tipo es la cotización", () => {
  test.each([
    [["Aquí te envío el link de pago", "https://www.dayanabeltran.com/pagar/p/therapy-6"], "Enlace de pago · paquete de 6 sesiones"],
    [
      ["NOMBRE DE BANCO:BANCO UNIÓN – WESTERN UNION\nNúmero de cuenta: 01735600000719409\nTeléfono celular :+57 3105833188", "175 USD \n580.000 COP"],
      "Datos del banco: Western Union · 175 USD",
    ],
    [
      ["Claro, Enny, te comparto los datos para el pago:\n\nBancolombia\nTipo de cuenta: Ahorros\nN° Cuenta: 15460415745\nDocumento CC: 1029145651"],
      "Datos del banco: Bancolombia",
    ],
    [["Aquí te envío mi número nequi 310-583-3188 a nombre de Diana Bel", "1 sesión  personalizada virtual 1.1 $190.000"], "Datos del banco: Nequi · $190.000"],
    [
      ["https://www.dayanabeltran.com/pagar/p/therapy-12", "NOMBRE DE BANCO:BANCO UNIÓN – WESTERN UNION\nNúmero de cuenta: 0173", "$2.227.000COP"],
      "Enlace y datos del banco: Western Union · paquete de 12 sesiones · $2.227.000COP",
    ],
    [["Titular: Diana Beltrán, cuenta corriente 123456789"], "Datos del banco: Cuenta bancaria"],
    [["Paquete de 6 sesiones \n\nValor con descuento \n\n$970.000 COP"], "Solo el valor · paquete de 6 sesiones · $970.000 COP"],
    // Revisión 22-oct: una cédula o un teléfono no son el valor.
    [["Western Union\nNombre: Diana Beltrán\nC.C. 52.123.456\nCiudad: Bogotá\nValor: 175 USD"], "Datos del banco: Western Union · 175 USD"],
    [["Número de contacto 310.583.3188, Nequi a nombre de Diana. Paquete de 6 sesiones 960.000"], "Datos del banco: Nequi · paquete de 6 sesiones · 960.000"],
    [["Nequi 3105833188, valor 175 USD"], "Datos del banco: Nequi · 175 USD"],
    [["Cédula 1.020.345.678 — el valor es 580.000 COP"], "Solo el valor · 580.000 COP"],
    [["Mándame el comprobante y agendamos"], "Le pidió el comprobante"],
  ])("%j → %s", (bodies, text) => {
    expect(quoteHowText(quoteHow(bodies))).toBe(text);
  });

  test("todos van al mismo seguimiento; la situación trae el tipo", () => {
    const s = quoteSituation(RAQUEL, { now: at("2026-10-22T17:00:00Z"), tz: TZ, lookbackDays: 14 })!;
    expect(s.how.kind).toBe("datos");
    expect(s.how.methods).toEqual(["Western Union"]);
  });
});

describe("quoteSituation", () => {
  test("Carmen: «ya quedamos para la primer semana de noviembre» → va a pagar ≈ 6 nov; el 1º el 7 a las 10 a. m. (no mañana)", () => {
    const lines = [
      dayana("OK hermosa, mi número de Nequi es 3105833188 \na nombre de Diana Bel \n\nPaquete de 6 sesiones \n\n960.000 mil", "2026-10-21T13:23:48Z"),
      dayana("Quedo atenta mi bella, tan pronto me envíes el comprobante de pago, agendamos día y hora que me digas", "2026-10-21T13:23:58Z"),
      person("Mil gracias🙏💕", "2026-10-21T13:25:30Z"),
      ai("Hola Carmen 🙏 ¿Pudiste hablar con Dayana en tu llamada gratis?", "2026-10-21T14:12:20Z"),
      person("Si señora mil gracias", "2026-10-21T14:12:30Z"),
      person("Si ella me lo y ya quedamos para la primer semana de noviembre", "2026-10-21T14:14:10Z"),
      ai("Te bendigo, Carmen 🙏 Muy bien. Entonces quedamos atentas para la primera semana de noviembre.", "2026-10-21T14:14:30Z"),
      person("Vale mil gracias🙏💕", "2026-10-21T14:15:10Z"),
    ];
    const s = quoteSituation(lines, { now: at("2026-10-22T20:00:00Z"), tz: BOG, lookbackDays: 14 })!;
    expect(s.state).toBe("pagara");
    expect(ymd(s.payBy, BOG)).toBe("2026-11-06");
    expect(quoteHowText(s.how)).toBe("Datos del banco: Nequi · paquete de 6 sesiones · 960.000 mil");
    expect(nextFollowUp(s, CONFIG, BOG)?.at.toISOString()).toBe("2026-11-07T15:00:00.000Z");
  });

  test("lo que la asistente manda después no reinicia la cotización (revisión 22-oct)", () => {
    const opts = { now: at("2026-10-22T20:00:00Z"), tz: BOG, lookbackDays: 14 };
    // S1: «pago el viernes» y la asistente contesta nombrando Nequi: sigue «va a pagar».
    const s1 = quoteSituation(
      [
        dayana("Mi Nequi es 3105833188 a nombre de Diana Bel", "2026-10-20T15:00:00Z"),
        person("Listo, pago el viernes", "2026-10-21T15:00:00Z"),
        ai("Cuando hagas el pago por Nequi, me mandas el comprobante por aquí", "2026-10-21T15:01:00Z"),
      ],
      opts
    )!;
    expect(s1.state).toBe("pagara");
    expect(ymd(s1.payBy, BOG)).toBe("2026-10-23");
    // S2: la asistente le reenvía el enlace después de «la primer semana de noviembre»: la fecha queda.
    const s2 = quoteSituation(
      [
        dayana("https://www.dayanabeltran.com/pagar/p/therapy-6", "2026-10-21T13:00:00Z"),
        person("Ya quedamos para la primera semana de noviembre", "2026-10-21T14:00:00Z"),
        ai("Puedes hacer el pago por el enlace que te envió Dayana.\n\nhttps://www.dayanabeltran.com/pagar/p/therapy-6", "2026-10-21T14:01:00Z"),
      ],
      opts
    )!;
    expect(s2).toMatchObject({ state: "pagara", quoteBy: "dayana" });
    expect(s2.quoteAt.toISOString()).toBe("2026-10-21T13:00:00.000Z");
    // S3: con los 2 seguimientos enviados, una respuesta de la asistente con datos no abre un 3º.
    const s3 = quoteSituation(
      [
        dayana("https://www.dayanabeltran.com/pagar/p/therapy-3", "2026-10-09T15:00:00Z"),
        followUp("2026-10-10T15:00:00Z", 1),
        followUp("2026-10-14T15:00:00Z", 2),
        person("Ok gracias", "2026-10-15T15:00:00Z"),
        ai("Con gusto. Cuando quieras, aquí están los datos:\n\nNequi 3001234567 a nombre de Prueba Uno", "2026-10-15T15:01:00Z"),
      ],
      opts
    )!;
    expect(s3.sent).toBe(2);
    expect(nextFollowUp(s3, CONFIG, BOG)).toBeNull();
    // Y una cotización de Dayana ya vencida no revive con los datos que la asistente mandó después.
    const old = quoteSituation(
      [
        dayana("https://www.dayanabeltran.com/pagar/p/therapy-3", "2026-10-01T15:00:00Z"),
        ai("Aquí están los datos:\n\nNequi 3001234567 a nombre de Prueba Uno", "2026-10-20T15:01:00Z"),
      ],
      opts
    );
    expect(old).toBeNull();
  });

  test("Patricia: el precio del curso no es una cotización: no hay seguimiento", () => {
    const lines = [
      dayana("🎤 Tenemos este evento el día domingo. Tenemos un curso los días miércoles y viernes, esa está en $60 si quisieses aprender.", "2026-10-20T14:18:36Z"),
      person("gracias Dayana, lo voy a tener en consideración", "2026-10-20T18:27:30Z"),
    ];
    expect(quoteSituation(lines, { now: at("2026-10-22T20:00:00Z"), tz: "America/Lima", lookbackDays: 14 })).toBeNull();
  });

  test("Raquel: la cotización es el último mensaje de Dayana con cómo pagar (su audio); va a pagar ≈ 31 oct", () => {
    const s = quoteSituation(RAQUEL, { now: at("2026-10-22T17:00:00Z"), tz: TZ, lookbackDays: 14 })!;
    expect(s.quoteAt.toISOString()).toBe("2026-10-22T16:20:00.000Z");
    expect(s.state).toBe("pagara");
    expect(ymd(s.payBy, TZ)).toBe("2026-10-31");
    expect(s.dayanaLastAt.toISOString()).toBe("2026-10-22T16:27:00.000Z");
    expect(s.awaitingReply).toBe(false);
  });

  test("la asistente: sus datos para pagar sí cuentan (dueña, 22-oct); «mándame el comprobante», el curso o un seguimiento no", () => {
    const opts = { now: at("2026-10-22T15:00:00Z"), tz: BOG, lookbackDays: 14 };
    const s = quoteSituation([ai("Te comparto los datos de Bancolombia: Número de cuenta 15460415745", "2026-10-20T15:00:00Z")], opts)!;
    expect(s).toMatchObject({ quoteBy: "asistente", state: "cotizada" });
    expect(quoteHowText(s.how)).toBe("Datos del banco: Bancolombia");
    expect(quotePromptLine(s, BOG)).toContain("Ya le mandaste cómo pagar");
    expect(quoteSituation([ai("Cuando hagas el pago, me mandas el comprobante por aquí", "2026-10-20T15:00:00Z")], opts)).toBeNull();
    expect(quoteSituation([ai("Aquí puedes tomar el curso: https://www.dayanabeltran.com/pagar/p/course-live", "2026-10-20T15:00:00Z")], opts)).toBeNull();
    // Un seguimiento ya enviado tras la cotización de Dayana no la reemplaza.
    const withFollowUp = quoteSituation(
      [dayana("https://www.dayanabeltran.com/pagar/p/therapy-3", "2026-10-15T15:00:00Z"), followUp("2026-10-17T15:00:00Z", 1)],
      opts
    )!;
    expect(withFollowUp.quoteAt.toISOString()).toBe("2026-10-15T15:00:00.000Z");
    expect(withFollowUp.sent).toBe(1);
  });

  test("sin cotización, o de hace más de 14 días: null", () => {
    expect(quoteSituation([person("Hola, ¿cuánto cuesta?", "2026-10-20T15:00:00Z")], { now: at("2026-10-22T15:00:00Z"), tz: BOG, lookbackDays: 14 })).toBeNull();
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

  test("contestó al 1º con «Gracias»: el 2º igual espera 4 días desde el 1º (revisión 22-oct)", () => {
    const lines = [quote, followUp("2026-10-21T15:00:00Z", 1), person("Gracias", "2026-10-21T16:00:00Z")];
    const s = quoteSituation(lines, { now: at("2026-10-24T15:00:00Z"), tz: BOG, lookbackDays: 14 })!;
    expect(nextFollowUp(s, CONFIG, BOG)).toEqual({ at: at("2026-10-25T15:00:00Z"), kind: "second" });
    const think = quoteSituation([quote, person("Lo voy a pensar", "2026-10-20T15:00:00Z"), followUp("2026-10-23T15:00:00Z", 1), person("Sí, todavía lo pienso", "2026-10-23T16:00:00Z")], {
      now: at("2026-10-24T15:00:00Z"),
      tz: BOG,
      lookbackDays: 14,
    })!;
    expect(nextFollowUp(think, CONFIG, BOG)?.at.getTime()).toBeGreaterThanOrEqual(at("2026-10-27T15:00:00Z").getTime());
  });

  test("una foto sin texto al final (puede ser el comprobante): espera; escribió hace 1 h: espera", () => {
    const photo: QuoteLine = { direction: "INBOUND", body: null, sentAt: at("2026-10-22T13:00:00Z"), media: true };
    const s = quoteSituation([quote, person("Gracias", "2026-10-19T20:05:00Z"), photo], { now: at("2026-10-24T15:00:00Z"), tz: BOG, lookbackDays: 14 })!;
    expect(s.awaitingReply).toBe(true);
    expect(followUpDue(s, CONFIG, { now: at("2026-10-24T15:00:00Z"), tz: BOG, lastOutboundAt: quote.sentAt })).toBeNull();
    const recent = quoteSituation([quote, person("Gracias", "2026-10-22T14:00:00Z")], { now: at("2026-10-22T15:00:00Z"), tz: BOG, lookbackDays: 14 })!;
    expect(followUpDue(recent, { ...CONFIG, firstAfterDays: 0 } as never, { now: at("2026-10-22T15:00:00Z"), tz: BOG, lastOutboundAt: quote.sentAt })).toBeNull();
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
    // El tipo es para Dayana: en el prompt hizo escalar a ENNY (eval 22-oct).
    expect(line).not.toContain("Datos del banco");
    expect(line).not.toContain("175 USD");
    expect(line).toContain("no escales");
  });

  test("si pide el enlace o los datos: le recuerda el paquete y se lo manda con la herramienta (ENNY, 23-oct)", () => {
    const enny = [
      dayana("Si deseas una terapia personalizada Virtual, aquí te envío el valor de la inversión.", "2026-10-14T14:45:00Z"),
      dayana("https://www.dayanabeltran.com/pagar/p/therapy-1", "2026-10-14T14:45:10Z"),
      person("Buenas tarde! me encantaría iniciar la próxima semana", "2026-10-23T17:56:00Z"),
    ];
    const s = quoteSituation(enny, { now: at("2026-10-23T17:58:00Z"), tz: BOG, lookbackDays: 30 })!;
    const line = quotePromptLine(s, BOG);
    expect(line).toContain("«Recuerda que con Dayana quedaron en una sesión»");
    expect(line).toContain("send_payment_link o send_payment_info");
    expect(line).toContain("los agenda Dayana cuando reciba el comprobante");
    // El de las notas de Dayana manda (Joselyn: 3 y 6 sesiones, primero el de 3).
    expect(quotePromptLine(s, BOG, "paquete de 3 sesiones")).toContain("quedaron en el paquete de 3 sesiones");
  });
});

describe("asksHowToPay / quotePayReply (ENNY, 23-oct)", () => {
  test.each([
    "Pon la fecha y el día y me emvias la forma de pago",
    "Me envías el link por favor",
    "Pásame los datos para pagar",
    "¿Cómo te pago?",
    "Regálame el número de cuenta",
    "Mándame el enlace",
  ])("pide cómo pagar: %s", (text) => {
    expect(asksHowToPay([text])).toBe(true);
  });

  test.each([
    "El link no me abre",
    "Me sale error en el enlace",
    "¿Me puedes enviar la factura del pago?",
    "Gracias, la otra semana pago",
    "¿En cuánto sale cada sesión?",
    // Revisión 23-oct: el enlace de otra cosa, o lo que tiene que ver Dayana.
    "Me envías el enlace de la sesión de mañana",
    "¿Me mandas el link de la clase del domingo?",
    "¿Cuál es el link del Meet?",
    "¿Me pasas el link del grupo?",
    "Ya pagué, ¿te mando los datos de la transferencia?",
    "¿Puedo pagar en dos cuotas? Me pasas los datos",
    "¿Me das un descuento? y me pasas el link",
    "Me mandas el link para pagar en dólares",
    "No tengo Nequi, ¿hay otra forma de pago?",
  ])("no (lo ve Dayana o no pide cómo pagar): %s", (text) => {
    expect(asksHowToPay([text])).toBe(false);
  });

  test("withQuoteReminder: el paquete y el comprobante si la respuesta no los dice (eval 23-oct)", () => {
    expect(withQuoteReminder("Entiendo, Enny. Te comparto nuevamente el enlace:", "1 sesión")).toBe(
      "Entiendo, Enny. Recuerda que con Dayana quedaron en una sesión. Te comparto nuevamente el enlace. Cuando hagas el pago, me mandas el comprobante por aquí y Dayana te agenda el día y la hora para iniciar."
    );
    expect(withQuoteReminder("Claro. Cuando lo hagas, me mandas el comprobante por aquí", "paquete de 3 sesiones")).toBe(
      "Claro. Recuerda que con Dayana quedaron en el paquete de 3 sesiones. Cuando lo hagas, me mandas el comprobante por aquí"
    );
    // Una sola frase: al principio. Ya lo dice: igual.
    expect(withQuoteReminder("Aquí tienes el enlace y me mandas el comprobante", "1 sesión")).toBe(
      "Recuerda que con Dayana quedaron en una sesión. Aquí tienes el enlace y me mandas el comprobante"
    );
    const said = "Claro, Enny. Recuerda que con Dayana quedaron en una sesión. Me mandas el comprobante por aquí.";
    expect(withQuoteReminder(said, "1 sesión")).toBe(said);
    expect(withQuoteReminder("Claro. Me mandas el comprobante.", null)).toBe("Claro. Me mandas el comprobante.");
  });

  test("en qué quedó con Dayana y lo que va debajo, sin precios", () => {
    expect(quotePayReply({ name: "Enny", pack: "1 sesión", what: "link" })).toBe(
      "Claro, Enny. Recuerda que con Dayana quedaron en una sesión. Cuando hagas el pago, me mandas el comprobante por aquí y Dayana te agenda el día y la hora para iniciar. Aquí tienes el enlace de pago"
    );
    expect(quotePayReply({ name: null, pack: "paquete de 24 sesiones", what: "data" })).toContain(
      "Claro. Recuerda que con Dayana quedaron en el paquete de 24 sesiones."
    );
    expect(quotePayReply({ name: null, pack: null, what: "dayana_data" })).toBe(
      "Claro. Recuerda que Dayana ya te envió cómo hacer el pago. Cuando hagas el pago, me mandas el comprobante por aquí y Dayana te agenda el día y la hora para iniciar. Puedes hacer el pago con los datos que te envió Dayana."
    );
  });
});
