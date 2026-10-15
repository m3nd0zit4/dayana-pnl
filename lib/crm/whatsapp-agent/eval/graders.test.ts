import { describe, expect, test } from "bun:test";

import { GRADERS, gradeReply, type GradeContext } from "./graders";

const ctx = (reply: string, extra: Partial<GradeContext> = {}): GradeContext => ({ reply, transcript: [], tools: [], ...extra });
const pass = (id: keyof typeof GRADERS, c: GradeContext) => GRADERS[id](c).pass;

// Respuestas reales de producción (octubre de 2026) que rompían una regla.
describe("calificadores con casos reales", () => {
  test("«querido» y corazones (Fernando, autoevaluación)", () => {
    expect(pass("sin_apodos", ctx("¿Desde qué país me escribes, querido?"))).toBe(false);
    expect(pass("sin_apodos", ctx("Gracias por hacer tu autoevaluación. Mi bella, leí lo que escribiste"))).toBe(false);
    expect(pass("sin_corazones", ctx("Hola Dayanna, te bendigo 💛 Gracias por hacer tu autoevaluación."))).toBe(false);
    expect(pass("sin_apodos", ctx("Hola Fernando, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"))).toBe(true);
  });

  test("hora militar (horas libres a Dayanna)", () => {
    expect(pass("horas_am_pm", ctx("• Jueves, 15 de octubre, 18:45"))).toBe(false);
    expect(pass("horas_am_pm", ctx("el jueves 15 de octubre a las 6:45 p. m."))).toBe(true);
    expect(pass("horas_am_pm", ctx("a las 9:15 a.m. (tu hora)"))).toBe(true);
  });

  test("saludo duplicado (reenvío a Yil)", () => {
    const yil =
      "Hola Yil, te bendigo. Gracias por hacer tu autoevaluación. Hola Yil, te bendigo. Gracias por hacer tu autoevaluación. Imagino que arrastrar algo desde hace tanto tiempo pesa.";
    expect(pass("sin_frases_repetidas", ctx(yil))).toBe(false);
  });

  test("hablar como Dayana (propuesta de Rosa, «quedamos agendadas»)", () => {
    expect(pass("voz_de_asistente", ctx("OK perfecto, entonces te llamo mañana jueves a las 8:15 p. m."))).toBe(false);
    expect(pass("voz_de_asistente", ctx("Perfecto, Dayanna. Quedamos agendadas para el jueves"))).toBe(false);
    expect(pass("voz_de_asistente", ctx("Dayana te llamará por WhatsApp a este número."))).toBe(true);
  });

  test("ciudad y horas en el mismo mensaje (Fernando)", () => {
    const fernando =
      "¿Qué ciudad de México me escribes? Así agendamos la llamada en tu horario. Tengo disponible\n- miércoles, 14 de octubre, 9:30 a. m. (tu hora)\n- miércoles, 14 de octubre, 9:45 a. m. (tu hora)";
    expect(pass("un_paso_a_la_vez", ctx(fernando))).toBe(false);
  });

  test("vuelve a preguntar el país ya contestado", () => {
    const transcript = [
      { direction: "OUTBOUND" as const, body: "¿Desde qué país me escribes?" },
      { direction: "INBOUND" as const, body: "Mexico" },
    ];
    expect(pass("no_repite_pregunta_pais", ctx("¿Desde qué país me escribes?", { transcript }))).toBe(false);
    // La ciudad, después del país, sí se puede preguntar.
    expect(pass("no_repite_pregunta_pais", ctx("¿Desde qué ciudad de México me escribes?", { transcript }))).toBe(true);
  });

  test("dice agendada solo si agendó", () => {
    const reply = "Queda agendada tu llamada gratis con Dayana para el jueves.";
    expect(pass("agendada_solo_si_agendo", ctx(reply))).toBe(false);
    expect(pass("agendada_solo_si_agendo", ctx(reply, { tools: [{ tool: "book_free_call", output: { booked: true } }] }))).toBe(true);
    expect(pass("agendada_solo_si_agendo", ctx(reply, { tools: [{ tool: "book_free_call", output: { pendingApproval: true } }] }))).toBe(false);
  });

  test("no vuelve a saludar", () => {
    const transcript = [
      { direction: "INBOUND" as const, body: "Hola" },
      { direction: "OUTBOUND" as const, body: "Hola Ana, te bendigo. ¿Cómo estás?", isAutoReply: true },
      { direction: "INBOUND" as const, body: "Bien" },
    ];
    expect(pass("no_vuelve_a_saludar", ctx("Hola Ana, te bendigo. Qué bueno.", { transcript }))).toBe(false);
    expect(pass("no_vuelve_a_saludar", ctx("Qué bueno, Ana. ¿Desde qué país me escribes?", { transcript }))).toBe(true);
  });

  test("los datos de pago pegados tal cual no cuentan como números escritos", () => {
    const block = "Bancolombia\nN° Cuenta: 15460415745";
    expect(pass("sin_numeros_de_cuenta", ctx(`Claro, te comparto los datos:\n\n${block}`, { paymentBlocks: [block] }))).toBe(true);
    expect(pass("sin_numeros_de_cuenta", ctx("Consigna a la cuenta 15460415745"))).toBe(false);
  });

  test("género sin adivinar (SF, Samy, Fernando)", () => {
    expect(pass("genero_sin_adivinar", ctx("Vale, perfecto. Cuando estés lista, por aquí estaré.", { gender: "unknown" }))).toBe(false);
    expect(pass("genero_sin_adivinar", ctx("Te sugiero estar pendiente y lista.", { gender: "unknown" }))).toBe(false);
    expect(pass("genero_sin_adivinar", ctx("Quedaste agendada para el jueves.", { gender: "m" }))).toBe(false);
    expect(pass("genero_sin_adivinar", ctx("Cuando quieras retomarlo, me escribes por aquí.", { gender: "unknown" }))).toBe(true);
    // Habla de la llamada, no de la persona.
    expect(pass("genero_sin_adivinar", ctx("Tu llamada quedó agendada para el jueves.", { gender: "unknown" }))).toBe(true);
    expect(pass("genero_sin_adivinar", ctx("Cuando estés lista, me escribes.", { gender: "f" }))).toBe(true);
  });

  test("no llama a la persona por un perfil que no es un nombre", () => {
    const profileName = "DIOS ES MI PROVEEDOR 🙏";
    expect(pass("no_usa_nombre_de_perfil", ctx("Sí, Dios es mi proveedor. Dayana te agrega con gusto.", { profileName }))).toBe(false);
    expect(pass("no_usa_nombre_de_perfil", ctx("Hola DIOS ES MI PROVEEDOR, te bendigo.", { profileName }))).toBe(false);
    expect(pass("no_usa_nombre_de_perfil", ctx("Claro, aquí puedes unirte a la comunidad. Dios te bendiga.", { profileName }))).toBe(true);
    expect(pass("no_usa_nombre_de_perfil", ctx("Hola SF, te bendigo.", { profileName: "SF" }))).toBe(false);
    expect(pass("no_usa_nombre_de_perfil", ctx("Hola Leidy, te bendigo.", { profileName: "Leidy" }))).toBe(true);
  });

  test("una respuesta buena pasa todo", () => {
    const transcript = [{ direction: "INBOUND" as const, body: "Hola, quiero información" }];
    const grades = gradeReply(ctx("Hola Lucía, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?", { transcript }));
    expect(grades.filter((g) => !g.pass)).toEqual([]);
  });
});

describe("plantilla al reenviar", () => {
  test("no repite el saludo de la plantilla (Yil)", async () => {
    const { templateMessage } = await import("@/lib/crm/whatsapp-resend");
    expect(
      templateMessage("Hola Yil, te bendigo 💛 Gracias por hacer tu autoevaluación. Imagino que arrastrar algo desde hace tanto tiempo pesa. ¿Te gustaría hablarlo con Dayana?")
    ).toBe("Imagino que arrastrar algo desde hace tanto tiempo pesa. ¿Te gustaría hablarlo con Dayana?");
    expect(templateMessage("¿Pudiste ver mi mensaje?\nQuedo atenta a tu respuesta por aquí.")).toBe("¿Pudiste ver mi mensaje?");
  });
});
