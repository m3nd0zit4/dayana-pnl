import { describe, expect, test } from "bun:test";

import { insults, plainLetters, RUDE_REPLY, rudeReplied } from "./rude-reply";

describe("plainLetters", () => {
  test("versalitas y letras matemáticas a letras normales", () => {
    expect(plainLetters("ʟᴏ ᴜɴɪᴄᴏ ǫ ʟᴇs ɪɴᴛᴇʀᴇsᴀ")).toBe("lo unico q les interesa");
    expect(plainLetters("𝐴𝑙𝑒")).toBe("Ale");
    expect(plainLetters("sᴇɴᴛɪ́ᴀ")).toBe("sentía");
  });
});

describe("insults (Alejandra, 27-oct)", () => {
  test("lo que escribió Alejandra, tal cual", () => {
    expect(
      insults([
        "ʟᴏ ᴜɴɪᴄᴏ ǫ ʟᴇs ɪɴᴛᴇʀᴇsᴀ ᴇs ʟᴀ ᴘʟᴀᴛᴀ .. sᴏʟᴏ ᴇʟ ǫ ᴀʏᴜᴅᴀ sᴇ ʟʟᴀᴍᴀ ᴅɪᴏs, ɴᴏ ᴇsᴀ ᴏᴛʀᴀ ǫ ɴɪ sɪǫᴜɪᴇʀᴀ ᴅᴇᴊᴏ ᴇxᴘʟɪᴄᴀʀ ǫ ᴇʀᴀ ʟᴏ ǫᴜᴇ sᴇɴᴛɪ́ᴀ ʏ sᴏʟᴏ ᴘɪᴅᴇ ᴇs ᴘʟᴀᴛᴀ \nᴄᴏᴍᴀɴ ᴍɪᴇʀᴅᴀ",
      ])
    ).toBe(true);
    expect(insults(["ɪɴᴛᴇʀᴇsᴀᴅᴀs"])).toBe(true);
  });

  test.each([
    "Coman mierda",
    "Váyanse a la mierda",
    "Son unas estafadoras",
    "Esto es una estafa",
    "Lo único que les interesa es el dinero",
    "Solo quieren plata",
    "Qué mierda de llamada",
    "Ustedes son unas aprovechadas",
    "Interesadas!!",
    "Malparidas",
  ])("insulta o acusa: %s", (text) => {
    expect(insults([text])).toBe(true);
  });

  test.each([
    "Me siento una mierda",
    "Mi vida es una basura",
    "Soy una estúpida, no sé qué hacer",
    "Me estafaron antes, por eso desconfío",
    "No tengo plata ahorita",
    "Me interesa el taller",
    "Estoy interesada en la terapia",
    "La llamada fue muy corta, no alcancé a contar todo",
    "Gracias por todo",
    "Ok",
    // Revisión 28-oct: lo que cuenta de otros, de sí, o una duda.
    "mi esposo es un hijueputa, me trata mal",
    "el malparido de mi ex no me deja en paz",
    "mis hermanos son unos interesados, solo les importa la plata",
    "a mi mamá solo le interesa el dinero",
    "mi expareja solo quiere dinero",
    "mis compañeros son unos idiotas",
    "Qué mierda de persona soy",
    "¿Esto es una estafa?",
    "no es una estafa verdad?",
    "Ya me han estafado otros estafadores",
    "Todos son unos interesados conmigo",
  ])("no es un insulto a Dayana: %s", (text) => {
    expect(insults([text])).toBe(false);
  });
});

describe("RUDE_REPLY y rudeReplied", () => {
  test("dice los 15 minutos, la agenda llena, las sesiones y las líneas gratuitas; sin «quedamos en contacto» ni género", () => {
    expect(RUDE_REPLY).toContain("15 minutos");
    expect(RUDE_REPLY).toMatch(/agenda está llena/);
    expect(RUDE_REPLY).toMatch(/sesiones personalizadas/);
    expect(RUDE_REPLY).toMatch(/líneas de atención gratuitas/);
    expect(RUDE_REPLY).not.toMatch(/quedamos en contacto|escuchada|atendida|lista\b/i);
  });

  test("ya se le mandó en los últimos 30 días", () => {
    const now = Date.UTC(2026, 9, 28);
    expect(rudeReplied([{ direction: "OUTBOUND", body: RUDE_REPLY, sentAt: new Date(now - 86_400_000) }], now)).toBe(true);
    expect(rudeReplied([{ direction: "OUTBOUND", body: RUDE_REPLY, sentAt: new Date(now - 40 * 86_400_000) }], now)).toBe(false);
    expect(rudeReplied([{ direction: "INBOUND", body: RUDE_REPLY, sentAt: new Date(now) }], now)).toBe(false);
  });
});
