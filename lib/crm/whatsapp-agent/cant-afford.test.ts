import { describe, expect, test } from "bun:test";

import { stateFromReply } from "./quote-follow-up-rules";
import {
  cheaperFollowUpText,
  cheaperLine,
  cheaperOptions,
  cheaperOverEscalation,
  cheaperReply,
  cheaperTemplateMessage,
  invitesFreeCall,
  saysCantAfford,
  saysHardNews,
  wantsToTalk,
  withCheaper,
  withoutReadyGender,
  type CheaperItem,
} from "./cant-afford";
import type { OpenWorkshop } from "./workshop-interest";

const BOG = "America/Bogota";
const AT = new Date("2026-10-24T16:17:51Z");
const says = (...texts: string[]) => saysCantAfford(texts, { at: AT, tz: BOG });

const WORKSHOP: OpenWorkshop = {
  id: "w1",
  title: "Tu Sanación con el Dinero",
  slug: "tu-sanacion-con-el-dinero",
  startsAt: new Date("2026-11-15T13:30:00Z"),
  startsAtHasTime: true,
  timezone: BOG,
  dateLabel: null,
  scheduleLabel: null,
  cardSummary: null,
  payUrl: "https://www.dayanabeltran.com/pagar/p/taller-tu-sanacion-con-el-dinero",
};
const COMMUNITY = "https://chat.whatsapp.com/GXPARCB8Ur0Fd0I78g2eYl";
const COURSE = {
  key: "curso-en-vivo",
  url: "https://www.dayanabeltran.com/pagar/p/course-live",
  label: "Curso en vivo con Dayana: clases en grupo por Google Meet, cupos limitados (más económico que la terapia 1:1)",
  enabled: true,
};
const ALL = cheaperOptions({ workshop: WORKSHOP, community: COMMUNITY, options: [COURSE] });
const NO_WORKSHOP = cheaperOptions({ workshop: null, community: COMMUNITY, options: [COURSE] });

describe("saysCantAfford", () => {
  test.each([
    ["Ahorita no tengo dinero y pues hace yer fue el entierro de mi hermana"], // Joselyn, 24-oct
    ["Buenas tardes. Sumercé es que no le he dado respuesta ya que no he tenido el dinero"], // Andrea, 23-oct
    ["Buen Día.  Sra Dayana si Sra .si  lo necesito pero por el factor económico aún no he podido apartar la cita"], // Andrea, 24-oct
    ["Me Gustaría Mucho Hablar Con Ella\nPero Ahorita No Tengo Para Pagarle Alguna Asesoría Pero Sie Gustaría Que Me Guiara"], // Divianys
    ["Disculpe lo he pensado, primero ahorraré y luego me inscribire, gracias"], // SF, 14-oct
    ["Doctora la verdad ahorita no me alcanza para pagar las sesiones, estoy muy apretada con la plata"],
    ["No tengo plata para iniciar"],
    ["Estoy sin dinero"],
    ["Está muy caro para mí"],
    ["Primero ahorro y te escribo"],
    ["🎤 Estamos ahorrando para seguir contigo"],
    ["Estoy tratando de reunir el dinero"],
  ])("sí: %s", (text) => {
    expect(says(text)).toBe(true);
  });

  // Lluvia, 26-oct: el enlace no la dejaba pagar (dos mensajes seguidos).
  test("no: «No puedo pagar» + «No me deja»", () => {
    expect(says("No puedo pagar", "No me deja")).toBe(false);
  });

  test.each([
    // Paola, 23-oct: espera un dinero la próxima semana (va a pagar).
    ["Hola, bueno estuve revisando pero como estoy sin empleo estoy corta de ahorros, estoy a la espera de la proxima semana recibir un dinero"],
    // Paola, 26-oct: solo le falta una parte.
    ["Hola, si estoy a la espera de un dinero para pagar la totalidad de las sesiones porque solo tengo una parte"],
    // Pide cómo pagar algo más barato: eso es pagar.
    ["No me alcanza para el de 6, ¿me mandas el link de pago del de 3?"],
    ["¿Es cuenta de ahorros?"],
    ["Ya tengo ahorrado, el viernes te pago"],
    ["No tengo tiempo para iniciar esta semana"],
    ["No es caro, me parece bien"],
    ["Ya no me interesa, gracias"],
    ["Gracias"],
    // Revisión 28-oct: quiere pagar algo de su proceso (la cuenta, otro paquete, cuándo empieza).
    ["Ya tengo mis ahorros, ¿a qué cuenta te pago?"],
    ["No me alcanza para el de 6, mándame el de 3"],
    ["El tema económico ya lo resolví, ¿cuándo empezamos?"],
    ["Económicamente estoy bien, gracias"],
    // Cuotas, un descuento, otra forma de pagar: eso sigue llegando a Dayana.
    ["No tengo el dinero completo, ¿puedo pagar en cuotas?"],
    ["No me alcanza, ¿me puedes hacer un descuento?"],
    ["Ahorita no tengo plata, ¿puedo abonar la mitad?"],
  ])("no: %s", (text) => {
    expect(says(text)).toBe(false);
  });

  test.each([
    ["Económicamente estoy muy mal en este momento"],
    ["Estoy pasando por una situación económica difícil"],
    ["Tengo un problema económico, por eso no he iniciado"],
    ["Se me acabaron los ahorros"],
  ])("lo económico con una dificultad, sí: %s", (text) => {
    expect(says(text)).toBe(true);
  });
});

describe("«sin dinero» en el seguimiento del cierre (revisión 28-oct)", () => {
  test.each([
    ["Ya tengo mis ahorros, ¿a qué cuenta te pago?", "pagara"],
    ["Económicamente estoy bien", null],
    ["El tema económico ya lo resolví", null],
    ["Por el factor económico aún no he podido apartar la cita", "sin_dinero"],
    ["No he tenido el dinero", "sin_dinero"],
  ])("«%s» → %s", (text, state) => {
    expect(stateFromReply(text, AT, BOG)?.state ?? null).toBe(state as never);
  });
});

describe("cheaperOverEscalation", () => {
  test("nunca una respuesta del modelo (las líneas de emergencia las arregla `serious`)", () => {
    expect(cheaperOverEscalation({ kind: "reply" }, { beforeCall: false })).toBe(false);
  });
  test("«Déjame consultarlo» (otra / no sabe / reagendar), sí; un pago o una queja, no", () => {
    for (const category of ["other", "unknown", "reschedule"]) expect(cheaperOverEscalation({ kind: "escalate", category }, { beforeCall: true })).toBe(true);
    for (const category of ["payment", "complaint"]) expect(cheaperOverEscalation({ kind: "escalate", category }, { beforeCall: false })).toBe(false);
  });
  test("lo clínico: después de la llamada sí (sería el paso del pago); antes, la llamada gratis", () => {
    expect(cheaperOverEscalation({ kind: "escalate", category: "clinical" }, { beforeCall: false })).toBe(true);
    expect(cheaperOverEscalation({ kind: "escalate", category: "clinical" }, { beforeCall: true })).toBe(false);
  });
});

describe("cheaperOptions", () => {
  test("el taller, luego la comunidad; como mucho dos", () => {
    expect(ALL.map((i) => i.kind)).toEqual(["workshop", "community"]);
    expect(ALL[0]).toMatchObject({ when: "domingo 15 de noviembre", url: WORKSHOP.payUrl });
  });
  test("sin taller abierto: la comunidad y el curso (nombre corto)", () => {
    expect(NO_WORKSHOP.map((i) => i.kind)).toEqual(["community", "course"]);
    expect(NO_WORKSHOP[1]).toMatchObject({ name: "curso en vivo con Dayana", url: COURSE.url });
  });
  test("un taller sin enlace de pago no se ofrece; sin nada, nada", () => {
    expect(cheaperOptions({ workshop: { ...WORKSHOP, payUrl: null }, community: null, options: [] })).toEqual([]);
  });
});

describe("cheaperLine", () => {
  test("nombra solo lo que hay, con sus herramientas, sin precios", () => {
    const line = cheaperLine(ALL, { beforeCall: false });
    expect(line).toContain("send_workshop_link");
    expect(line).toContain("send_community_link");
    expect(line).not.toContain("send_affordable_option");
    expect(line).not.toMatch(/\$|\d+\.\d{3}/);
  });
  test("antes de la llamada, primero la llamada gratis", () => {
    expect(cheaperLine(NO_WORKSHOP, { beforeCall: true })).toMatch(/no tiene costo/);
    expect(cheaperLine(NO_WORKSHOP, { beforeCall: true })).not.toContain("taller");
  });
});

describe("withCheaper", () => {
  const joselyn =
    "Te entiendo de corazón, Joselyn. Siento mucho la pérdida de tu hermana, te bendigo en este momento tan difícil.\n\nGuarda este espacio para ti y, cuando puedas, me avisas y avanzamos.";

  test("Joselyn, 24-oct: no ofreció nada → su texto + el taller y la comunidad, con los enlaces", () => {
    const r = withCheaper(joselyn, ALL, { attached: [], replace: false, beforeCall: false, name: "Joselyn" });
    expect(r.replaced).toBe(false);
    // Su texto (sin «de corazón») y debajo lo más económico.
    expect(r.text.startsWith(joselyn.replace(" de corazón", ""))).toBe(true);
    expect(r.text).toContain("el taller «Tu Sanación con el Dinero», el domingo 15 de noviembre");
    expect(r.text).toContain("la comunidad de Dayana en WhatsApp, que es gratis");
    expect(r.links).toEqual([WORKSHOP.payUrl!, COMMUNITY]);
    expect(r.text.split(/\s+/).length).toBeLessThanOrEqual(90);
  });

  test("ya mandó el taller con la herramienta: tal cual", () => {
    const r = withCheaper("Te entiendo. Mientras tanto, está el taller.", ALL, { attached: [WORKSHOP.payUrl!], replace: false, beforeCall: false, name: null });
    expect(r).toEqual({ text: "Te entiendo. Mientras tanto, está el taller.", links: [], replaced: false });
  });

  test("nombró el taller sin la herramienta: se pega el enlace", () => {
    const r = withCheaper("Te entiendo. Si quieres, puedes separar tu cupo en el taller del 15.", ALL, { attached: [], replace: false, beforeCall: false, name: null });
    expect(r.links).toEqual([WORKSHOP.payUrl!]);
    expect(r.text).toBe("Te entiendo. Si quieres, puedes separar tu cupo en el taller del 15.");
  });

  test("solo ofreció la comunidad: falta el taller", () => {
    const r = withCheaper("Te entiendo. Puedes unirte gratis a la comunidad de Dayana.", ALL, { attached: [COMMUNITY], replace: false, beforeCall: false, name: null });
    expect(r.links).toEqual([WORKSHOP.payUrl!]);
    expect(r.text).toMatch(/También está el taller «Tu Sanación con el Dinero»/);
  });

  test("escaló o «déjame consultarlo»: la respuesta del código", () => {
    const r = withCheaper("Déjame consultarlo con Dayana y te confirmo por aquí.", ALL, { attached: [], replace: true, beforeCall: false, name: "Andrea" });
    expect(r.replaced).toBe(true);
    expect(r.text).toBe(cheaperReply(ALL, { name: "Andrea", beforeCall: false }));
    expect(r.text).toMatch(/^Te entiendo, Andrea, no te preocupes 🙏 Cuando puedas iniciar tu proceso, Dayana queda atenta\./);
    expect(r.links).toEqual([WORKSHOP.payUrl!, COMMUNITY]);
  });

  test("Divianys, 24-oct (antes de la llamada): le ofrece la llamada gratis → tal cual", () => {
    const text = "Te entiendo. Por eso la llamada con Dayana es completamente gratis, de 15 minutos y sin costo ni compromiso.\n\n¿Quieres que te agende el espacio?";
    expect(invitesFreeCall(text)).toBe(true);
    const talk = wantsToTalk(["Me Gustaría Mucho Hablar Con Ella\nPero Ahorita No Tengo Para Pagarle Alguna Asesoría Pero Sie Gustaría Que Me Guiara"]);
    expect(talk).toBe(true);
    expect(withCheaper(text, ALL, { attached: [], replace: false, beforeCall: true, name: null, talk })).toEqual({ text, links: [], replaced: false });
  });

  test("SF (eval 28-oct): no pidió hablar; la llamada gratis sola no basta → también lo más económico", () => {
    const text = "Entiendo perfectamente. Te recuerdo que la llamada gratis con Dayana no tiene ningún costo ni compromiso, por si en algún momento deseas conversar con ella.";
    const talk = wantsToTalk(["Disculpe lo he pensado, primero ahorraré y luego me inscribire, gracias"]);
    expect(talk).toBe(false);
    const r = withCheaper(text, ALL, { attached: [], replace: false, beforeCall: true, name: null, talk });
    expect(r.links).toEqual([WORKSHOP.payUrl!, COMMUNITY]);
    expect(r.text).not.toMatch(/Y la llamada con Dayana no tiene costo/); // ya lo dijo
  });

  test("antes de la llamada, el modelo ofreció la comunidad: el taller y que la llamada no tiene costo", () => {
    const r = withCheaper("Te entiendo. Puedes unirte gratis a la comunidad de Dayana.", ALL, { attached: [COMMUNITY], replace: false, beforeCall: true, name: null });
    expect(r.text).toMatch(/También está el taller .*\. Y la llamada con Dayana no tiene costo/);
  });

  test("SF, 14-oct (antes de la llamada, «quedamos en contacto»): lo más económico + la llamada no tiene costo", () => {
    const r = withCheaper("Entendido, perfecto. Quedamos en contacto; si necesitas algo, me escribes por aquí.", NO_WORKSHOP, {
      attached: [],
      replace: false,
      beforeCall: true,
      name: null,
    });
    expect(r.text).toMatch(/comunidad de Dayana en WhatsApp/);
    expect(r.text).toMatch(/la llamada con Dayana no tiene costo/);
    expect(r.links).toEqual([COMMUNITY, COURSE.url]);
  });

  test("termina en una pregunta: la frase va antes", () => {
    const r = withCheaper("Te entiendo, no te preocupes. ¿Te puedo ayudar en algo más?", NO_WORKSHOP, { attached: [], replace: false, beforeCall: false, name: null });
    expect(r.text.endsWith("¿Te puedo ayudar en algo más?")).toBe(true);
    expect(r.text.indexOf("comunidad")).toBeLessThan(r.text.indexOf("¿Te puedo"));
  });

  test("muy larga con la frase: la del código", () => {
    const long = Array.from({ length: 60 }, () => "palabra").join(" ");
    expect(withCheaper(long, ALL, { attached: [], replace: false, beforeCall: false, name: null }).replaced).toBe(true);
  });

  test("Joselyn: contó algo duro → la respuesta del código empieza por eso", () => {
    expect(saysHardNews(["Ahorita no tengo dinero y pues hace yer fue el entierro de mi hermana"])).toBe(true);
    expect(saysHardNews(["No tengo plata"])).toBe(false);
    expect(cheaperReply(ALL, { name: null, beforeCall: false, hard: true })).toMatch(/^Siento mucho lo que estás pasando 🙏/);
  });

  test("«cuando estés lista» → «cuando puedas» (no sabe su género)", () => {
    expect(withoutReadyGender("Cuando estés lista, me avisas. Y cuando te sientas preparado, también.")).toBe("Cuando puedas, me avisas. Y cuando puedas, también.");
    expect(withoutReadyGender("Cuando tengas el momento y estés lista, por aquí estamos.")).toBe("Cuando tengas el momento y puedas, por aquí estamos.");
    // Eval 28-oct (Joselyn): «Cuando puedas y estés lista» no queda «puedas y puedas».
    expect(withoutReadyGender("Cuando puedas y estés lista, me avisas.")).toBe("Cuando puedas, me avisas.");
    expect(withoutReadyGender("Cuando puedas y puedas hacerlo, aquí estaremos.")).toBe("Cuando puedas, aquí estaremos.");
    // Eval 28-oct (Joselyn): «lista y dispuesta», «de todo corazón», «con todo respeto y cariño».
    expect(withoutReadyGender("Cuando estés lista y dispuesta, por aquí estaremos.")).toBe("Cuando puedas, por aquí estaremos.");
    expect(withoutReadyGender("Siento mucho lo de tu hermana, te acompaño de todo corazón.")).toBe("Siento mucho lo de tu hermana, te acompaño.");
    expect(withoutReadyGender("Te mando un abrazo con todo respeto y cariño.")).toBe("Te mando un abrazo con todo respeto.");
    expect(withoutReadyGender("Te entiendo de corazón, Joselyn. Te acompaño con el corazón en este momento.")).toBe("Te entiendo, Joselyn. Te acompaño en este momento.");
    const r = withCheaper("Te entiendo. Cuando estés lista, me avisas.", ALL, { attached: [WORKSHOP.payUrl!], replace: false, beforeCall: false, name: null });
    expect(r.text).toBe("Te entiendo. Cuando puedas, me avisas.");
  });

  test("sin opciones: nada cambia", () => {
    expect(withCheaper("Hola", [], { attached: [], replace: true, beforeCall: false, name: null })).toEqual({ text: "Hola", links: [], replaced: false });
  });
});

describe("el seguimiento del cierre", () => {
  test("dentro de las 24 h: lo más económico y los enlaces debajo; nunca «¿Cuándo te gustaría empezar?»", () => {
    const text = cheaperFollowUpText("Andrea", ALL);
    expect(text.startsWith("Hola Andrea, te bendigo 🙏")).toBe(true);
    expect(text).not.toMatch(/cu[aá]ndo te gustar[ií]a empezar/i);
    expect(text).toContain(`\n\n${WORKSHOP.payUrl}\n\n${COMMUNITY}`);
  });

  test("la variable de la plantilla: una línea, ≤ 300, con los enlaces enteros", () => {
    for (const items of [ALL, NO_WORKSHOP, ALL.slice(0, 1)]) {
      const m = cheaperTemplateMessage(items);
      expect(m.length).toBeLessThanOrEqual(300);
      expect(m).not.toMatch(/\n|\t| {5}/);
      expect(m).toContain(items[0].url);
    }
    expect(cheaperTemplateMessage(ALL)).toContain(COMMUNITY);
  });

  test("un título larguísimo se acorta, el enlace no", () => {
    const long: CheaperItem[] = [{ kind: "workshop", title: "Sanación ".repeat(40).trim(), when: "domingo 15 de noviembre", url: WORKSHOP.payUrl! }];
    const m = cheaperTemplateMessage(long);
    expect(m.length).toBeLessThanOrEqual(300);
    expect(m.endsWith(WORKSHOP.payUrl!)).toBe(true);
  });
});
