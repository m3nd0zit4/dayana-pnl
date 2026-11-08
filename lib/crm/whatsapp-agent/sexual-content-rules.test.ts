import { describe, expect, test } from "bun:test";

import {
  explicitSexualText,
  isScreenableAttachment,
  mediaVerdict,
  SEXUAL_CONTENT_NOTICE,
  sexualHint,
  sparedFromAutoBlock,
  textVerdictBlocks,
} from "./sexual-content-rules";

describe("texto sexual inequívoco (bloquea sin preguntar)", () => {
  test.each([
    ["mándame fotos desnuda", "nude_request"],
    ["Envíame un video en ropa interior", "nude_request"],
    ["pasame tu pack", "nude_request"],
    ["mándame un pack de fotos", "nude_request"],
    ["quiero ver fotos tuyas sin ropa", "nude_request"],
    ["me mandas nudes?", "nude_request"],
    ["quiero follarte", "proposition"],
    ["me gustaría hacerte el amor", "proposition"],
    ["quiero tener sexo contigo", "proposition"],
    ["chúpame la verga", "directed_act"],
    ["mira mi verga", "directed_act"],
    ["me la tienes dura", "directed_act"],
    ["hacemos sexo virtual?", "sexual_offer"],
    ["hagamos videollamada hot?", "sexual_offer"],
    ["vendo pack baratito", "sexual_offer"],
    ["mira https://www.pornhub.com/view_video", "sexual_offer"],
    // Letras de adorno (como Alejandra con versalitas).
    ["ᴍᴀɴᴅᴀᴍᴇ ᴛᴜ ᴘᴀᴄᴋ", "nude_request"],
  ])("«%s» → %s", (text, rule) => {
    expect(explicitSexualText(text)).toBe(rule);
  });

  test.each([
    // Terapia, salud, abuso contado, pareja: nunca.
    "Sufrí abuso sexual de niña y quiero sanarlo",
    "tengo problemas en la intimidad con mi esposo",
    "mi pareja ya no tiene deseo sexual, ¿eso se trabaja en terapia?",
    "me siento mal con mi cuerpo, no me gusta verme desnuda en el espejo",
    "Mi ginecóloga me dijo que tengo una infección vaginal y estoy muy ansiosa",
    "¿trabajas temas de sexualidad?",
    "te mando foto del comprobante",
    "mándame el enlace por favor",
    "me mandas la foto del taller?",
    "voy a coger el bus y te escribo",
    "Mi ex me mandaba fotos íntimas sin pedírselas y eso me afectó",
    "mi novio me manda fotos desnudas y no sé cómo decirle que pare",
    "estoy caliente de fiebre, hoy no puedo la llamada",
    "estoy bien caliente contigo, no me contestaste ayer",
    "estoy excitada por empezar la terapia",
    // El «pack» de Dayana es de sesiones.
    "pásame el pack de sesiones",
    "mándame el pack de 6 por favor",
    // Su tema de terapia, no una oferta.
    "mi esposo ve pornhub todo el día",
    "tengo adicción al sexo virtual",
    "me escribieron haciendo sexting y me sentí fatal",
    "",
  ])("no es contenido sexual: «%s»", (text) => {
    expect(explicitSexualText(text)).toBeNull();
  });
});

describe("palabras que solo suenan sexuales (las decide el modelo)", () => {
  test("despiertan la revisión", () => {
    for (const t of ["hola sexy", "tengo un pack", "sufrí abuso sexual", "estoy caliente", "la tengo bien parada", "¿qué llevas puesto?", "🍆"]) {
      expect(sexualHint(t)).toBe(true);
    }
  });
  test("lo normal no", () => {
    for (const t of ["hola, buenas tardes", "quiero agendar la llamada", "¿cuánto cuesta la terapia?", "gracias 🙏😊", null, ""]) {
      expect(sexualHint(t)).toBe(false);
    }
  });
  test("el modelo bloquea solo si es explícito, dirigido y con confianza alta", () => {
    expect(textVerdictBlocks({ explicit: true, kind: "proposition", confidence: 0.95 })).toBe(true);
    expect(textVerdictBlocks({ explicit: true, kind: "harassment", confidence: 0.9 })).toBe(true);
    expect(textVerdictBlocks({ explicit: true, kind: "proposition", confidence: 0.7 })).toBe(false);
    expect(textVerdictBlocks({ explicit: true, kind: "therapy", confidence: 0.99 })).toBe(false);
    expect(textVerdictBlocks({ explicit: true, kind: "victim", confidence: 0.99 })).toBe(false);
    expect(textVerdictBlocks({ explicit: false, kind: "proposition", confidence: 0.99 })).toBe(false);
    expect(textVerdictBlocks(null)).toBe(false);
  });
});

describe("lo que devolvió Gemini al mirar una foto", () => {
  test("PROHIBITED_CONTENT sobre el archivo solo = sexual; IMAGE_SAFETY solo con la categoría sexual", () => {
    expect(mediaVerdict({ blockReason: "PROHIBITED_CONTENT" }).verdict).toBe("sexual");
    expect(mediaVerdict({ finishReason: "IMAGE_PROHIBITED_CONTENT" }).verdict).toBe("sexual");
    expect(mediaVerdict({ finishReason: "IMAGE_SAFETY" }).verdict).toBe("unknown");
    expect(
      mediaVerdict({ finishReason: "IMAGE_SAFETY", ratings: [{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", probability: "HIGH" }] }).verdict
    ).toBe("sexual");
  });
  test("SAFETY solo cuenta si saltó la categoría sexual", () => {
    expect(
      mediaVerdict({ blockReason: "SAFETY", ratings: [{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", probability: "HIGH" }] }).verdict
    ).toBe("sexual");
    expect(
      mediaVerdict({
        blockReason: "SAFETY",
        ratings: [
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", probability: "HIGH", blocked: true },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", probability: "NEGLIGIBLE" },
        ],
      }).verdict
    ).toBe("unknown");
  });
  test("puntaje sexual alto y el modelo de acuerdo, o el modelo seguro sin puntaje en contra", () => {
    const high = [{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", probability: "HIGH" }];
    expect(mediaVerdict({ ratings: high, answer: { sexual: true, confidence: 0.9 } }).verdict).toBe("sexual");
    expect(mediaVerdict({ answer: { sexual: true, nudity: true, confidence: 0.92 } }).verdict).toBe("sexual");
    // Se contradicen: no se borra nada (se guarda como siempre).
    expect(mediaVerdict({ ratings: high, answer: { sexual: false } }).verdict).toBe("unknown");
    expect(
      mediaVerdict({ ratings: [{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", probability: "NEGLIGIBLE" }], answer: { sexual: true, confidence: 0.9 } }).verdict
    ).toBe("unknown");
  });
  test("dudoso o limpio no bloquea", () => {
    expect(mediaVerdict({ answer: { sexual: true, confidence: 0.5 } }).verdict).toBe("ok");
    expect(mediaVerdict({ answer: { sexual: false, confidence: 0.99 } }).verdict).toBe("ok");
    expect(
      mediaVerdict({ ratings: [{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", probability: "MEDIUM" }], answer: { sexual: false } }).verdict
    ).toBe("ok");
    expect(mediaVerdict({ error: "timeout" }).verdict).toBe("unknown");
    expect(mediaVerdict({ finishReason: "OTHER" }).verdict).toBe("unknown");
    expect(mediaVerdict({}).verdict).toBe("unknown");
  });
});

describe("qué se revisa y a quién no se bloquea solo", () => {
  test("fotos, stickers y videos; no audios ni documentos", () => {
    expect(isScreenableAttachment("image", "image/jpeg")).toBe(true);
    expect(isScreenableAttachment("sticker", "image/webp")).toBe(true);
    expect(isScreenableAttachment("video", "video/mp4")).toBe(true);
    expect(isScreenableAttachment("audio", "audio/ogg")).toBe(false);
    expect(isScreenableAttachment("document", "application/pdf")).toBe(false);
  });
  test("números personales y del equipo se salvan (Dayana decide)", () => {
    expect(sparedFromAutoBlock({ personalNumber: true, category: null })).toBe(true);
    expect(sparedFromAutoBlock({ personalNumber: false, category: "equipo" })).toBe(true);
    expect(sparedFromAutoBlock({ personalNumber: false, category: "personal" })).toBe(true);
    expect(sparedFromAutoBlock({ personalNumber: false, category: "cliente" })).toBe(false);
    expect(sparedFromAutoBlock({ personalNumber: false, category: null })).toBe(false);
  });
  test("el aviso usa las palabras de la dueña y no dice que ya se reportó", () => {
    expect(SEXUAL_CONTENT_NOTICE).toContain("va a ser reportado");
    expect(SEXUAL_CONTENT_NOTICE).toContain("debido a estas acciones");
    expect(SEXUAL_CONTENT_NOTICE).not.toMatch(/fue reportado|ya reportamos/);
  });
});
