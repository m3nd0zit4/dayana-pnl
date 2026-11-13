import { describe, expect, test } from "bun:test";

import { writesOwnHours } from "./reply-guards";
import { isHoldingLine, waitBeforeReplyMs } from "./reply-timing";

describe("waitBeforeReplyMs (13-nov: contestaba mientras la persona seguía escribiendo)", () => {
  test("un mensaje completo: lo normal", () => {
    expect(waitBeforeReplyMs("Quiero agendar la llamada para mañana en la tarde", 20000)).toBe(20000);
    expect(waitBeforeReplyMs("¿Cuánto cuesta la terapia?", 20000)).toBe(20000);
    expect(waitBeforeReplyMs("🎤 Hola, buenos días, recuerda hoy es que no puedo", 20000)).toBe(20000);
    expect(waitBeforeReplyMs(null, 20000)).toBe(20000);
  });
  test("un saludo solo o una frase cortada: espera más", () => {
    for (const t of ["Hola", "Buenas tardes", "Hola buenas noches", "Quiero saber sobre", "Tengo un problema con mi hija y", "Mira,", "pues..."]) {
      expect([t, waitBeforeReplyMs(t, 20000)]).toEqual([t, 35000]);
    }
  });
});

describe("isHoldingLine", () => {
  test("los avisos de espera", () => {
    for (const t of [
      "Déjame consultarlo con Dayana y te confirmo por aquí.",
      "Déjame confirmarlo con Dayana y te escribo por aquí.",
      "Ya le paso tu mensaje a Dayana; ella revisa su agenda y te confirma por aquí.",
      "Déjame revisar la agenda de Dayana y te comparto por aquí los horarios disponibles.",
    ]) {
      expect([t, isHoldingLine(t)]).toEqual([t, true]);
    }
    expect(isHoldingLine("Con gusto 🙏")).toBe(false);
    expect(isHoldingLine("Estas son las horas libres de Dayana")).toBe(false);
  });
});

describe("writesOwnHours (13-nov: horas inventadas → las de la agenda)", () => {
  test("horas de la llamada escritas a mano", () => {
    expect(writesOwnHours("Tengo espacio el jueves a las 4 pm para tu llamada con Dayana")).toBe(true);
    expect(writesOwnHours("Dayana tiene disponible mañana 10:00 a. m. o 3:00 p. m.")).toBe(true);
  });
  test("lo demás no", () => {
    expect(writesOwnHours("El taller es el domingo de 8:30 a. m. a 4:30 p. m.")).toBe(false);
    expect(writesOwnHours("El webinar es el sábado a las 7 pm")).toBe(false);
    expect(writesOwnHours("Con gusto, te bendigo")).toBe(false);
    expect(writesOwnHours("¿Desde qué país me escribes?")).toBe(false);
  });
});
