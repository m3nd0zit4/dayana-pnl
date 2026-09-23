import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";

import { filesFromUpload, historyEventsFrom, parseHistoryText } from "./history-import";

const thread = {
  id: "573001112233",
  messages: [
    { from: "573001112233", id: "h1", timestamp: "1780000000", type: "text", text: { body: "Hola Dayana" } },
    { from: "573105833188", id: "h2", timestamp: "1780000100", type: "text", text: { body: "Hola linda, ¿cómo estás?" } },
  ],
};

const webhook = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba",
      changes: [
        {
          field: "history",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: "pn" },
            history: [{ metadata: { phase: 0, chunk_order: 1, progress: 100 }, threads: [thread] }],
          },
        },
      ],
    },
  ],
};

describe("importar historial de 360dialog", () => {
  test("aviso completo", () => {
    const events = historyEventsFrom(parseHistoryText(JSON.stringify(webhook)));
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.kind === "message" && e.isHistory)).toBe(true);
    const [client, dayana] = events;
    expect(client.kind === "message" && client.isEcho).toBe(false);
    expect(dayana.kind === "message" && dayana.isEcho).toBe(true);
  });

  test("lista de avisos, NDJSON, solo el value, y un trozo suelto", () => {
    const value = webhook.entry[0].changes[0].value;
    expect(historyEventsFrom(parseHistoryText(JSON.stringify([webhook, webhook])))).toHaveLength(4);
    expect(historyEventsFrom(parseHistoryText(`${JSON.stringify(webhook)}\n${JSON.stringify(webhook)}`))).toHaveLength(4);
    expect(historyEventsFrom(parseHistoryText(JSON.stringify(value)))).toHaveLength(2);
    expect(historyEventsFrom(parseHistoryText(JSON.stringify({ threads: [thread] })))).toHaveLength(2);
  });

  test("zip con varios archivos", () => {
    const zip = zipSync({ "a.json": strToU8(JSON.stringify(webhook)), "b.json": strToU8(JSON.stringify(webhook)) });
    const texts = filesFromUpload("historial.zip", zip);
    expect(texts).toHaveLength(2);
    expect(historyEventsFrom(texts.flatMap(parseHistoryText))).toHaveLength(4);
  });
});
