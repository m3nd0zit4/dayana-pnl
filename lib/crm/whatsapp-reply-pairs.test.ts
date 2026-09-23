import { describe, expect, test } from "bun:test";

import {
  extractReplyPairs,
  pairsFromExport,
  parseWhatsAppExport,
  type PairInputMessage,
} from "./whatsapp-reply-pairs";

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 1, 12, minutes));

const msg = (
  id: string,
  direction: "INBOUND" | "OUTBOUND",
  body: string | null,
  minutes: number,
  isHuman = true
): PairInputMessage => ({ id, direction, body, sentAt: at(minutes), isHuman });

describe("extractReplyPairs", () => {
  test("junta varios mensajes seguidos de cada lado en un par", () => {
    const pairs = extractReplyPairs([
      msg("1", "INBOUND", "hola", 0),
      msg("2", "INBOUND", "¿cuánto vale la terapia?", 1),
      msg("3", "OUTBOUND", "Hola hermosa 💛", 5),
      msg("4", "OUTBOUND", "Te paso los precios", 6),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].clientText).toBe("hola\n¿cuánto vale la terapia?");
    expect(pairs[0].replyText).toBe("Hola hermosa 💛\nTe paso los precios");
    expect(pairs[0].replyKey).toBe("3");
  });

  test("una respuesta automática no es un ejemplo de Dayana", () => {
    const pairs = extractReplyPairs([
      msg("1", "INBOUND", "hola", 0),
      msg("2", "OUTBOUND", "¡Hola! Gracias por escribir", 0, false),
      msg("3", "OUTBOUND", "Hola, soy Dayana", 3),
    ]);
    expect(pairs).toHaveLength(0);
  });

  test("varias vueltas dan varios pares, en orden", () => {
    const pairs = extractReplyPairs([
      msg("1", "INBOUND", "a", 0),
      msg("2", "OUTBOUND", "b", 1),
      msg("3", "INBOUND", "c", 2),
      msg("4", "OUTBOUND", "d", 3),
    ]);
    expect(pairs.map((p) => [p.clientText, p.replyText])).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  test("lo que Dayana escribe sin que nadie pregunte no es respuesta", () => {
    expect(
      extractReplyPairs([msg("1", "OUTBOUND", "Recordatorio", 0)])
    ).toEqual([]);
  });

  test("una respuesta dos días después no cuenta", () => {
    const pairs = extractReplyPairs([
      msg("1", "INBOUND", "hola", 0),
      msg("2", "OUTBOUND", "perdón la demora", 60 * 49),
    ]);
    expect(pairs).toHaveLength(0);
  });

  test("un adjunto sin texto no rompe el par", () => {
    const pairs = extractReplyPairs([
      msg("1", "INBOUND", null, 0),
      msg("2", "INBOUND", "¿y esto?", 1),
      msg("3", "OUTBOUND", null, 2),
      msg("4", "OUTBOUND", "Es el material", 3),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].clientText).toBe("¿y esto?");
    expect(pairs[0].replyText).toBe("Es el material");
  });
});

describe("parseWhatsAppExport", () => {
  test("formato Android con líneas de continuación y adjuntos", () => {
    const raw = [
      "23/09/26, 14:05 - Los mensajes y las llamadas están cifrados de extremo a extremo.",
      "23/09/26, 14:05 - Ana: Hola, ¿cuánto vale?",
      "23/09/26, 14:06 - Ana: <Multimedia omitido>",
      "23/09/26, 14:10 - Dayana Beltrán: Hola Ana 💛",
      "El proceso de 4 sesiones vale 480.000",
    ].join("\n");
    const parsed = parseWhatsAppExport(raw);
    expect(parsed.senders.map((s) => s.name)).toEqual([
      "Ana",
      "Dayana Beltrán",
    ]);
    expect(parsed.messages[1].text).toBeNull();
    expect(parsed.messages[2].text).toBe(
      "Hola Ana 💛\nEl proceso de 4 sesiones vale 480.000"
    );

    const pairs = pairsFromExport(parsed.messages, "Dayana Beltrán");
    expect(pairs).toHaveLength(1);
    expect(pairs[0].clientText).toBe("Hola, ¿cuánto vale?");
  });

  test("formato iPhone con corchetes, segundos y a. m. / p. m.", () => {
    const raw = [
      "‎[1/9/26, 2:05:33 p. m.] Luis: buenas",
      "[1/9/26, 2:07:00 p. m.] Dayana: Hola Luis",
    ].join("\n");
    const parsed = parseWhatsAppExport(raw);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].sender).toBe("Luis");
    expect(parsed.messages[0].at.getHours()).toBe(14);
    expect(pairsFromExport(parsed.messages, "Dayana")[0].replyText).toBe(
      "Hola Luis"
    );
  });
});
