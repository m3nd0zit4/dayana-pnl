import { describe, expect, test } from "bun:test";

import {
  contactNameFromFileName,
  DAYANA_MEDIA_NOTE,
  detectDayanaAuthor,
  normalizePhoneInput,
  parseExportFile,
  toHistoryEvents,
} from "./whatsapp-export-history";

const ANDROID = [
  "22/09/26, 9:58 - Los mensajes y las llamadas están cifrados de extremo a extremo. Nadie fuera de este chat, ni siquiera WhatsApp, puede leerlos ni escucharlos.",
  "22/09/26, 10:00 - Laura: Hola Dayana, ¿cuánto cuesta la sesión?",
  "22/09/26, 10:02 - Dayana Beltrán: Hola Laura 💛 la sesión cuesta 150.000",
  "y dura una hora",
  "22/09/26, 10:03 - Laura: <Multimedia omitido>",
  "22/09/26, 10:04 - Laura cambió su número de teléfono.",
  "22/09/26, 10:05 - Dayana Beltrán: Se eliminó este mensaje",
  "22/09/26, 10:06 - Laura: Perfecto, gracias",
].join("\n");

const IPHONE = [
  "[22/09/26, 10:00:05] Laura Pérez: \u200eLos mensajes y las llamadas están cifrados de extremo a extremo.",
  "[22/09/26, 10:00:10] Laura Pérez: Hola",
  "[22/09/26, 10:01:00] Dayana: \u200eimagen omitida",
  "[22/09/26, 10:02:00] Dayana: Hola hermosa",
].join("\n");

describe("contactNameFromFileName", () => {
  test("español, inglés, iPhone y duplicados", () => {
    expect(contactNameFromFileName("Chat de WhatsApp con Laura Pérez.txt")).toBe("Laura Pérez");
    expect(contactNameFromFileName("WhatsApp Chat with +57 300 123 4567.txt")).toBe("+57 300 123 4567");
    expect(contactNameFromFileName("WhatsApp Chat - Laura.zip")).toBe("Laura");
    expect(contactNameFromFileName("C:\\fakepath\\Chat de WhatsApp con Ana (1).txt")).toBe("Ana");
    expect(contactNameFromFileName("_chat.txt")).toBe("");
  });
});

describe("normalizePhoneInput", () => {
  test("formatos comunes", () => {
    expect(normalizePhoneInput("+57 300 123 4567")).toBe("+573001234567");
    expect(normalizePhoneInput("+52 1 55 1234 5678")).toBe("+5215512345678");
    expect(normalizePhoneInput("3001234567")).toBe("+573001234567");
    expect(normalizePhoneInput("Laura")).toBeNull();
    expect(normalizePhoneInput("+12")).toBeNull();
  });
});

describe("parseExportFile", () => {
  test("Android: multilínea, adjuntos, borrados y avisos de sistema", () => {
    const parsed = parseExportFile("Chat de WhatsApp con Laura.txt", ANDROID, "America/Bogota");
    expect(parsed.contactName).toBe("Laura");
    expect(parsed.phoneFromName).toBeNull();
    expect(parsed.authors.sort()).toEqual(["Dayana Beltrán", "Laura"]);
    expect(parsed.messages).toHaveLength(5);
    expect(parsed.messages[1]!.body).toBe("Hola Laura 💛 la sesión cuesta 150.000\ny dura una hora");
    expect(parsed.messages[2]).toMatchObject({ author: "Laura", body: null, media: true });
    expect(parsed.messages[3]).toMatchObject({ author: "Dayana Beltrán", body: null, media: false });
    // 10:00 en Bogotá (UTC-5) = 15:00 UTC.
    expect(parsed.messages[0]!.sentAt.toISOString()).toBe("2026-09-22T15:00:00.000Z");
  });

  test("iPhone: el aviso de cifrado no cuenta como mensaje", () => {
    const parsed = parseExportFile("_chat.txt", IPHONE);
    expect(parsed.messages).toHaveLength(3);
    expect(parsed.messages[1]).toMatchObject({ author: "Dayana", media: true });
    expect(parsed.contactName).toBe("Laura Pérez");
  });

  test("teléfono en el nombre del archivo", () => {
    const parsed = parseExportFile("Chat de WhatsApp con +52 1 55 1234 5678.txt", ANDROID);
    expect(parsed.phoneFromName).toBe("+5215512345678");
  });
});

describe("detectDayanaAuthor", () => {
  test("el que no es el contacto", () => {
    expect(detectDayanaAuthor(["Laura", "Dayita"], { contactName: "Laura" })).toBe("Dayita");
    expect(detectDayanaAuthor(["Laura", "Dayana Beltrán"], {})).toBe("Dayana Beltrán");
    expect(detectDayanaAuthor(["+57 300 123 4567", "Yo"], {})).toBe("Yo");
    expect(detectDayanaAuthor(["Laura"], { contactName: "Laura" })).toBeNull();
    expect(detectDayanaAuthor(["Laura", "Ana"], { override: "ana" })).toBe("Ana");
  });
});

describe("toHistoryEvents", () => {
  const parsed = parseExportFile("Chat de WhatsApp con Laura.txt", ANDROID);
  const build = () =>
    toHistoryEvents({
      phoneE164: "+52 55 1234 5678".replace(/\s/g, ""),
      contactName: parsed.contactName,
      dayanaAuthor: "Dayana Beltrán",
      messages: parsed.messages,
      metaAccountId: "acc",
    });

  test("historial, dirección, adjuntos y número de México", () => {
    const events = build();
    // El mensaje borrado no se guarda.
    expect(events).toHaveLength(4);
    expect(events.every((e) => e.isHistory && e.threadId === "5215512345678")).toBe(true);
    expect(events.map((e) => e.isEcho)).toEqual([false, true, false, false]);
    expect(events[2]).toMatchObject({ system: true, body: DAYANA_MEDIA_NOTE });
    expect(events[0]!.externalMessageId).toMatch(/^export:[0-9a-f]{40}$/);
  });

  test("ids deterministas y estables con repeticiones", () => {
    expect(build().map((e) => e.externalMessageId)).toEqual(build().map((e) => e.externalMessageId));
    const same = parseExportFile("x.txt", "22/09/26, 10:00 - Laura: Hola\n22/09/26, 10:00 - Laura: Hola");
    const ids = toHistoryEvents({
      phoneE164: "+573001234567",
      contactName: "Laura",
      dayanaAuthor: null,
      messages: same.messages,
      metaAccountId: "acc",
    }).map((e) => e.externalMessageId);
    expect(new Set(ids).size).toBe(2);
  });
});
