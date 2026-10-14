import { describe, expect, test } from "bun:test";

import { pickImages } from "./vision";

const img = (url: string, kind = "image", mimeType = "image/jpeg") => ({ kind, url, mimeType });

describe("qué imágenes ve la IA", () => {
  test("las últimas de la persona, la más reciente primero, máximo 3", () => {
    const picks = pickImages([
      { direction: "INBOUND", attachments: [img("a")] },
      { direction: "INBOUND", attachments: [img("b")] },
      { direction: "OUTBOUND", attachments: [img("mia")] },
      { direction: "INBOUND", attachments: [img("c"), img("d", "sticker", "image/webp")] },
      { direction: "INBOUND", attachments: [img("e")] },
    ]);
    expect(picks.map((p) => p.url)).toEqual(["e", "c", "d"]);
  });
  test("sin URL, audios, documentos y avisos de sistema no cuentan", () => {
    expect(
      pickImages([
        { direction: "INBOUND", attachments: [{ kind: "image", url: null, mimeType: "image/jpeg" }] },
        { direction: "INBOUND", attachments: [{ kind: "audio", url: "x", mimeType: "audio/ogg" }] },
        { direction: "INBOUND", attachments: [{ kind: "document", url: "y", mimeType: "application/pdf" }] },
        { direction: "INBOUND", kind: "system", attachments: [img("z")] },
      ])
    ).toEqual([]);
  });
  test("sin copia propia (Blob suspendido), la pide a WhatsApp por su id mientras la guarde (7 días)", () => {
    const now = Date.parse("2026-10-14T12:00:00Z");
    const picks = pickImages(
      [
        { direction: "INBOUND", sentAt: new Date("2026-10-01T12:00:00Z"), attachments: [{ kind: "image", url: null, mediaId: "111111", mimeType: "image/jpeg" }] },
        { direction: "INBOUND", sentAt: new Date("2026-10-14T11:00:00Z"), attachments: [{ kind: "image", url: null, mediaId: "222222", mimeType: "image/jpeg", unavailableReason: "upload_failed" }] },
      ],
      now
    );
    expect(picks).toEqual([{ url: null, mediaId: "222222", mimeType: "image/jpeg" }]);
  });
});
