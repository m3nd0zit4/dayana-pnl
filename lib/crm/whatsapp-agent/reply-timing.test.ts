import { describe, expect, test } from "bun:test";

import { asksAboutSchedule, fixZoneClaims, withoutPlaceholders, writesOwnHours } from "./reply-guards";
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

describe("asksAboutSchedule (revisión 13-nov)", () => {
  test("va de agendar: sí; una pregunta de otra cosa: no", () => {
    expect(asksAboutSchedule(["¿Qué horarios tienes?"])).toBe(true);
    expect(asksAboutSchedule(["Sí"])).toBe(true);
    expect(asksAboutSchedule(["¿Cuánto cuesta la terapia?"])).toBe(false);
    expect(asksAboutSchedule(["Gracias por la información"])).toBe(false);
  });
});

describe("withoutPlaceholders (Estrella, 14-nov: «Perfecto, [Estrella/nombre].»)", () => {
  const t = "Perfecto, [Estrella/nombre]. Ya sabemos que estás en Colombia. Si gustas, dime en qué horario te queda mejor.";
  test("el nombre: por el seguro o fuera con su coma", () => {
    expect(withoutPlaceholders(t, null)).toBe("Perfecto. Ya sabemos que estás en Colombia. Si gustas, dime en qué horario te queda mejor.");
    expect(withoutPlaceholders(t, "Estrella")).toBe("Perfecto, Estrella. Ya sabemos que estás en Colombia. Si gustas, dime en qué horario te queda mejor.");
    expect(withoutPlaceholders("Hola [nombre], te bendigo.", null)).toBe("Hola, te bendigo.");
  });
  test("otro hueco: la frase entera fuera; un enlace Markdown, intacto", () => {
    expect(withoutPlaceholders("Listo. Tu llamada es a las [hora]. Dayana te llama.", null)).toBe("Listo. Dayana te llama.");
    expect(withoutPlaceholders("Mira [aquí](https://x.com)", null)).toBe("Mira [aquí](https://x.com)");
    expect(withoutPlaceholders("Hola, ¿cómo estás?", null)).toBe("Hola, ¿cómo estás?");
  });
});

describe("fixZoneClaims (Manuel, Venezuela, 14-nov)", () => {
  test("la segunda hora la calcula el código", () => {
    expect(fixZoneClaims("Sí, Manuel: las 7:00 p. m. de Colombia son las 7:00 p. m. de Venezuela.", 60)).toBe(
      "Sí, Manuel: las 7:00 p. m. de Colombia son las 8:00 p. m. de Venezuela."
    );
    expect(fixZoneClaims("las 6:15 p. m. de Colombia son las 8:15 p. m. de tu hora", 120)).toBe("las 6:15 p. m. de Colombia son las 8:15 p. m. de tu hora");
    expect(fixZoneClaims("las 7:00 p. m. de Colombia son las 7:00 p. m. de tu hora", null)).toBe("las 7:00 p. m. de Colombia son las 7:00 p. m. de tu hora");
  });
});
