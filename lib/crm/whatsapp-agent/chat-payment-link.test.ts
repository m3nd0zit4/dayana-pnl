import { describe, expect, test } from "bun:test";

import { askedPackage, asksForBankDetails, dayanaPaymentDataBodies, dayanaPaymentInfo, dayanaPaymentLink, dayanaPaymentLinks, isPaymentData, isPaymentInfo, paymentInfoKind, pickPaymentLink, withoutPayUrls } from "./chat-payment-link";

const now = new Date("2026-10-21T15:20:00Z");
const at = (iso: string) => new Date(iso);
const dayana = (body: string, sentAt = at("2026-10-21T13:56:19Z")) => ({ direction: "OUTBOUND" as const, body, sentAt });
const ai = (body: string, sentAt = at("2026-10-21T14:58:01Z")) => ({ direction: "OUTBOUND" as const, body, isAutoReply: true, sentAt });
const inb = (body: string, sentAt = at("2026-10-21T15:14:08Z")) => ({ direction: "INBOUND" as const, body, sentAt });

describe("dayanaPaymentLinks: todos los que mandó (Joselyn, 21-oct)", () => {
  const joselyn = [
    dayana("Ya te envío el link de pago el paquete de tres sesiones", at("2026-10-05T21:49:21Z")),
    dayana("https://www.dayanabeltran.com/pagar/p/therapy-3", at("2026-10-05T21:50:22Z")),
    dayana("Y ese es el link de pago para el paquete de seis sesiones", at("2026-10-05T21:50:29Z")),
    dayana("https://www.dayanabeltran.com/pagar/p/therapy-6", at("2026-10-05T21:50:37Z")),
    inb("Todo los miedos que tengo"),
  ];
  test("el más nuevo primero, cada uno con su paquete", () => {
    expect(dayanaPaymentLinks(joselyn, now).map((l) => [l.url, l.label])).toEqual([
      ["https://www.dayanabeltran.com/pagar/p/therapy-6", "paquete de 6 sesiones"],
      ["https://www.dayanabeltran.com/pagar/p/therapy-3", "paquete de 3 sesiones"],
    ]);
  });
  test("el mismo enlace dos veces cuenta una; uno de 1 sesión; uno sin producto", () => {
    const lines = [
      dayana("https://www.dayanabeltran.com/pagar/p/therapy-1", at("2026-10-20T10:00:00Z")),
      dayana("https://www.dayanabeltran.com/pagar/p/therapy-1", at("2026-10-20T11:00:00Z")),
      dayana("https://www.dayanabeltran.com/pagar/abc123", at("2026-10-20T12:00:00Z")),
    ];
    expect(dayanaPaymentLinks(lines, now).map((l) => l.label)).toEqual(["enlace de pago", "1 sesión"]);
  });
  test("pickPaymentLink: el que dice la nota («paquete de 3 sesiones», «3», «tres»); si no, el último", () => {
    const links = dayanaPaymentLinks(joselyn, now);
    expect(pickPaymentLink(links, "paquete de 3 sesiones")?.url).toBe("https://www.dayanabeltran.com/pagar/p/therapy-3");
    expect(pickPaymentLink(links, "el de tres sesiones")?.url).toBe("https://www.dayanabeltran.com/pagar/p/therapy-3");
    expect(pickPaymentLink(links, "therapy-3")?.url).toBe("https://www.dayanabeltran.com/pagar/p/therapy-3");
    expect(pickPaymentLink(links, undefined)?.url).toBe("https://www.dayanabeltran.com/pagar/p/therapy-6");
    expect(pickPaymentLink(links, "el de 24")?.url).toBe("https://www.dayanabeltran.com/pagar/p/therapy-6");
    expect(pickPaymentLink([], "3")).toBeNull();
    // La nota de Dayana, larga: cuenta «N sesiones», no una fecha («el 6 de octubre»).
    const note =
      "Ya se le ha llamado el 6 de octubre y ha tenido conversacion pero solo quiere cosas gratis, no se le agendan mas llamadas hasta que pague el paquete de 3 seciones.";
    expect(pickPaymentLink(links, note)?.url).toBe("https://www.dayanabeltran.com/pagar/p/therapy-3");
    // «paquete de N» manda sobre otro número de sesiones en la nota (revisión 21-oct).
    const withOne = [...links, { url: "https://www.dayanabeltran.com/pagar/p/therapy-1", sentAt: null, label: "1 sesión" }];
    expect(pickPaymentLink(withOne, "Ya tuvo 1 sesión hace meses; que pague el paquete de 3 sesiones")?.url).toBe(
      "https://www.dayanabeltran.com/pagar/p/therapy-3"
    );
    expect(pickPaymentLink(links, "Le llamé el 6 de octubre, quiere cosas gratis y no paga nunca nada de lo que se le manda")?.url).toBe(
      "https://www.dayanabeltran.com/pagar/p/therapy-6"
    );
  });
});

describe("dayanaPaymentLink", () => {
  test("Paola: el enlace que Dayana mandó desde el celular", () => {
    const lines = [
      dayana("🎤 Hermosa, te voy a enviar el link de pago y mi website para que puedas mirar.", at("2026-10-21T13:55:58Z")),
      dayana("https://www.dayanabeltran.com/pagar/p/therapy-24"),
      ai("Hola Paola, ¿pudiste hablar con Dayana en tu llamada del miércoles, 21 de octubre? Responde SÍ o NO por aquí."),
      inb("Si"),
    ];
    expect(dayanaPaymentLink(lines, now)).toEqual({ url: "https://www.dayanabeltran.com/pagar/p/therapy-24", sentAt: at("2026-10-21T13:56:19Z") });
  });

  test("dentro de una frase, sin el punto final", () => {
    expect(dayanaPaymentLink([dayana("Aquí está tu link: https://www.dayanabeltran.com/pagar/abc123.")], now)?.url).toBe(
      "https://www.dayanabeltran.com/pagar/abc123"
    );
  });

  test("lo que mandó la asistente (curso, sesión urgente) no cuenta", () => {
    expect(dayanaPaymentLink([ai("Aquí puedes hacer el pago:\n\nhttps://www.dayanabeltran.com/pagar/p/course-live")], now)).toBeNull();
  });

  test("uno de hace más de 30 días ya no cuenta", () => {
    expect(dayanaPaymentLink([dayana("https://www.dayanabeltran.com/pagar/p/therapy-24", at("2026-09-10T13:00:00Z"))], now)).toBeNull();
  });

  test("sin enlace", () => {
    expect(dayanaPaymentLink([dayana("Hola Paola, te bendigo"), inb("Si")], now)).toBeNull();
  });
});

describe("isPaymentInfo con { amounts: false } (lo viejo, de más de 30 días)", () => {
  test("Natalia (5-sep): «quedo atenta al comprobante de pago» sí cuenta", () => {
    expect(
      isPaymentInfo("OK hermosa, quedo atenta al comprobante de pago para iniciar con tu Terapia de reprogramación neuronal lo mereces. Te bendigo", {
        amounts: false,
      })
    ).toBe(true);
    expect(isPaymentInfo("https://www.dayanabeltran.com/pagar/p/therapy-3", { amounts: false })).toBe(true);
  });
  test("un precio suelto de hace meses no; el de una sesión reciente sí", () => {
    expect(isPaymentInfo("La sesión está en $50.000", { amounts: false })).toBe(false);
    expect(isPaymentInfo("La sesión está en $50.000")).toBe(true);
  });
});

describe("askedPackage / dayanaPaymentDataBodies", () => {
  test("el paquete que nombra", () => {
    expect(askedPackage("Mejor quiero el paquete de 3 sesiones, me envías el link")).toBe(3);
    expect(askedPackage("las seis sesiones")).toBe(6);
    expect(askedPackage("me envías la forma de pago")).toBeNull();
    // Revisión 23-oct: sin «sesiones».
    expect(askedPackage("Mejor el paquete de 6, me pasas el link")).toBe(6);
    expect(askedPackage("Quiero el de 6")).toBe(6);
    expect(askedPackage("el link del paquete de seis")).toBe(6);
    expect(askedPackage("el de 3:00 me queda bien")).toBeNull();
    expect(askedPackage("el de 3 de la tarde")).toBeNull();
  });
  test("solo los datos que Dayana mandó ella misma en los últimos 30 días", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    const lines = [
      { direction: "OUTBOUND" as const, body: "Nequi 3001112233", sentAt: new Date("2026-08-01T12:00:00Z") },
      { direction: "OUTBOUND" as const, body: "Bancolombia ahorros 15460415745", sentAt: new Date("2026-10-14T12:00:00Z") },
      { direction: "OUTBOUND" as const, body: "Nequi 3004445566", sentAt: new Date("2026-10-15T12:00:00Z"), isAutoReply: true },
    ];
    expect(dayanaPaymentDataBodies(lines, now)).toEqual(["Bancolombia ahorros 15460415745"]);
  });
});

describe("isPaymentInfo: el precio de un curso o el de antes de la llamada no es «ya hablaron» (Patricia, Montoya, 23-oct)", () => {
  test("un curso, un taller, un evento: no", () => {
    expect(isPaymentInfo("El taller del sábado cuesta $50.000")).toBe(false);
    expect(
      isPaymentInfo("🎤 Tenemos un curso los días miércoles y viernes, acá vas a tener capacitación y entrenamiento en horas de la noche, esa está en $60 si quisieses aprender")
    ).toBe(false);
  });
  test("lo que cuesta una sesión dicho para invitarla a la llamada: no", () => {
    expect(
      isPaymentInfo(
        "🎤 Ah, ok, te entiendo. Bueno, la llamada es básicamente para poder sacar un diagnóstico y saber cuántas sesiones de reprogramación necesitas. Una sola sesión está en 190.000 pesos, dura una hora."
      )
    ).toBe(false);
  });
  test("con datos o «mándame el comprobante» sí, aunque hable del curso", () => {
    expect(isPaymentInfo("Mi Nequi es 3105833188 para el curso")).toBe(true);
    expect(isPaymentInfo("El curso queda en $60, me mandas el comprobante")).toBe(true);
    expect(isPaymentInfo("El paquete de tres sesiones te queda en 510.000")).toBe(true);
  });
});

describe("isPaymentInfo / dayanaPaymentInfo", () => {
  test("lo que Dayana manda para pagar (Carmen, Raquel, Claudia)", () => {
    expect(isPaymentInfo("OK hermosa, mi número de Nequi es 3105833188 \na nombre de Diana Bel\n\nPaquete de 6 sesiones\n\n960.000 mil")).toBe(true);
    expect(isPaymentInfo("NOMBRE DE BANCO:BANCO UNIÓN – WESTERN UNION\nEnvío directo a cuenta en Colombia\nNúmero de cuenta: 0173")).toBe(true);
    expect(isPaymentInfo("175 USD \n580.000 COP")).toBe(true);
    // «te envío el link de pago» sin el enlace no basta (puede ser «después te mando…»): el enlace sí.
    expect(isPaymentInfo("Aquí te envío el link de pago para el paquete de 12 sesiones")).toBe(false);
    expect(isPaymentInfo("Tan pronto me envíes el comprobante agendamos día y hora que me digas")).toBe(true);
    expect(isPaymentInfo("https://www.dayanabeltran.com/pagar/p/therapy-12")).toBe(true);
  });

  test("lo que se le parece y no es (revisión 21-oct)", () => {
    expect(isPaymentInfo("¿A nombre de quién agendo la llamada?")).toBe(false);
    expect(isPaymentInfo("Después de la llamada te mando el link de pago")).toBe(false);
    expect(isPaymentInfo("Te mando el comprobante de inscripción al webinar")).toBe(false);
  });

  test("solo un valor dice que hablaron de precios, pero no son datos para pagar", () => {
    expect(isPaymentInfo("La sesión vale $150.000")).toBe(true);
    expect(isPaymentInfo("Mándame el comprobante y agendamos")).toBe(true);
    expect(isPaymentData("La sesión vale $150.000")).toBe(false);
    expect(isPaymentData("Mi Nequi es 3105833188")).toBe(true);
    expect(isPaymentData("Titular de la cuenta: Diana Beltrán")).toBe(true);
  });

  test("cualquier otro banco o medio cuenta como datos para pagar (dueña, 22-oct)", () => {
    for (const text of [
      "Bancolombia ahorros 15460415745",
      "Te paso mi Davivienda",
      "Mi Zelle es pagos@ejemplo.com",
      "PayPal: dayana.beltran@gmail.com",
      "https://www.paypal.me/JuliannMB",
      "Yape 987 654 321",
      "Ahorros 1546041574 a mi nombre",
      "Mi cuenta es 0173 0000 1234 5678",
      "IBAN ES12 3456 7890 1234 5678",
      "CLABE 012180001234567891",
      "Banco Santander, a tu nombre",
      "Cuenta 4567-8901-23 Banco Pichincha",
    ]) {
      expect(isPaymentData(text)).toBe(true);
    }
  });

  test("lo que se le parece y no es: un lugar, «me di cuenta», «fui al banco»", () => {
    for (const text of [
      "Soy de Santander",
      "Me di cuenta de algo importante",
      "Fui al banco esta mañana",
      "Ten en cuenta que dura una hora",
      // Revisión 22-oct: horas, teléfonos y fechas después de «en cuenta».
      "Hola hermosa, ten en cuenta que la llamada es de 10:00 - 10:15",
      "Tenlo en cuenta: 10:30 - 10:45",
      "Ten en cuenta que te llamo del 300 456 7890",
      "Ten en cuenta que es el 22 - 23 de octubre",
      "🎤 Cierra los ojos y cuenta 1 2 3 4 5 6 7, respira",
      // PayPal y Mercado Pago son los rieles de la web: nombrarlos no son datos.
      "Puedes pagar con tarjeta o PayPal en la página",
      "El curso lo pagas por Mercado Pago en la web",
    ]) {
      expect(isPaymentData(text)).toBe(false);
    }
    expect(paymentInfoKind("La sesión vale $150.000")).toBe("amount");
    expect(paymentInfoKind("Mándame el comprobante y agendamos")).toBe("receipt");
    expect(paymentInfoKind("Mi Nequi es 3105833188")).toBe("data");
    expect(paymentInfoKind("Hola, te bendigo")).toBeNull();
  });

  test("un masivo o una propuesta aprobada no es Dayana", () => {
    const bulk = { direction: "OUTBOUND" as const, body: "Taller $80.000 https://www.dayanabeltran.com/pagar/p/taller-x", source: "bulk:abc", sentAt: at("2026-10-21T13:00:00Z") };
    const approved = { direction: "OUTBOUND" as const, body: "N° Cuenta: 123", source: "approval", sentAt: at("2026-10-21T13:00:00Z") };
    expect(dayanaPaymentInfo([bulk], now)).toBeNull();
    expect(dayanaPaymentLink([bulk], now)).toBeNull();
    expect(dayanaPaymentInfo([approved], now)).toBeNull();
  });

  test("un saludo o una hora no es cómo pagar", () => {
    expect(isPaymentInfo("Hola Carmen, te bendigo buenos días")).toBe(false);
    expect(isPaymentInfo("Te llamo a las 10:30 a. m.")).toBe(false);
    expect(isPaymentInfo("El domingo de 9:30 a 12:30")).toBe(false);
  });

  test("el último de Dayana, no lo de la asistente", () => {
    const lines = [
      dayana("OK hermosa, mi número de Nequi es 3105833188", at("2026-10-21T13:23:00Z")),
      ai("Hola Carmen 🙏 ¿Pudiste hablar con Dayana en tu llamada gratis?"),
      inb("Si señora mil gracias"),
    ];
    expect(dayanaPaymentInfo(lines, now)).toEqual({ sentAt: at("2026-10-21T13:23:00Z"), link: null });
    expect(dayanaPaymentInfo([ai("Te comparto los datos: N° Cuenta: 123")], now)).toBeNull();
  });
});

describe("withoutPayUrls", () => {
  test("el enlace copiado a mano sale del texto (también «Https://»)", () => {
    const r = withoutPayUrls("Como ya te compartió el enlace, puedes realizarlo directamente desde ahí:\nHttps://www.dayanabeltran.com/pagar/p/therapy-24\n\nMe mandas el comprobante por aquí.");
    expect(r.had).toBe(true);
    expect(r.text).toBe("Como ya te compartió el enlace, puedes realizarlo directamente desde ahí.\n\nMe mandas el comprobante por aquí.");
    expect(withoutPayUrls("Puedes pagar aquí: https://www.dayanabeltran.com/pagar/p/therapy-24").text).toBe("Puedes pagar aquí");
  });

  test("sin enlace no cambia nada", () => {
    expect(withoutPayUrls("Claro, Paola.")).toEqual({ text: "Claro, Paola.", had: false });
  });
});

describe("asksForBankDetails", () => {
  test("un «sí» o «quiero pagar» no pide la cuenta", () => {
    expect(asksForBankDetails(["Si"])).toBe(false);
    expect(asksForBankDetails(["Listo, ¿cómo pago?"])).toBe(false);
    expect(asksForBankDetails(["Quiero empezar, ya voy a pagar"])).toBe(false);
    expect(asksForBankDetails(["Me di cuenta de que necesito ayuda"])).toBe(false);
  });

  test("pide la cuenta, transferir u otro medio", () => {
    expect(asksForBankDetails(["¿Me pasas el número de cuenta?"])).toBe(true);
    expect(asksForBankDetails(["Prefiero hacer transferencia"])).toBe(true);
    expect(asksForBankDetails(["¿Tienes Nequi?"])).toBe(true);
    expect(asksForBankDetails(["Me pasas los datos para consignar"])).toBe(true);
    expect(asksForBankDetails(["Estoy en Venezuela, ¿puedo por Western Union?"])).toBe(true);
    expect(asksForBankDetails(["No tengo tarjeta"])).toBe(true);
  });

  test("el enlace no le sirve", () => {
    expect(asksForBankDetails(["El link no me deja pagar"])).toBe(true);
    expect(asksForBankDetails(["No me abre el enlace"])).toBe(true);
    expect(asksForBankDetails(["No pude pagar"])).toBe(true);
  });
});

describe("el enlace de un taller no es cómo pagar su proceso (25-oct)", () => {
  const taller = "https://www.dayanabeltran.com/pagar/p/taller-tu-sanacion-con-el-dinero";
  test("no son datos de pago ni «ya hablaron»; con otro dato sí", () => {
    expect(isPaymentData(`Aquí puedes separar tu cupo en el taller: ${taller}`)).toBe(false);
    expect(isPaymentInfo(`Aquí puedes separar tu cupo en el taller: ${taller}`)).toBe(false);
    expect(paymentInfoKind(taller)).toBe(null);
    expect(isPaymentData(`${taller}\nY tu sesión: https://www.dayanabeltran.com/pagar/p/therapy-3`)).toBe(true);
  });
  test("no es «el enlace que te mandó Dayana»: se sigue buscando el de su proceso", () => {
    const lines = [dayana("https://www.dayanabeltran.com/pagar/p/therapy-3", at("2026-10-20T13:00:00Z")), dayana(taller)];
    expect(dayanaPaymentLink(lines, now)?.url).toBe("https://www.dayanabeltran.com/pagar/p/therapy-3");
    expect(dayanaPaymentLinks(lines, now).map((l) => l.url)).toEqual(["https://www.dayanabeltran.com/pagar/p/therapy-3"]);
    expect(dayanaPaymentLink([dayana(taller)], now)).toBe(null);
  });
});
