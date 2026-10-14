import { describe, expect, it } from "bun:test";

import { cleanableAttachment, cleanedAttachment, isInboundBlobUrl } from "./media-cleanup-rules";

const IN = "https://abc123.private.blob.vercel-storage.com/inbox/6f1c2d3e-aaaa-bbbb-cccc-1234567890ab.jpg";
const OUT = "https://abc123.private.blob.vercel-storage.com/inbox/outbound/6f1c2d3e-aaaa-bbbb-cccc-1234567890ab.jpg";

describe("limpieza de fotos y audios", () => {
  it("solo copias propias de lo que llegó", () => {
    expect(isInboundBlobUrl(IN)).toBe(true);
    expect(isInboundBlobUrl(OUT)).toBe(false);
    expect(isInboundBlobUrl("https://example.com/inbox/x.jpg")).toBe(false);
    expect(isInboundBlobUrl(null)).toBe(false);
  });

  it("fotos y videos sí; stickers, documentos y lo que manda Dayana no", () => {
    expect(cleanableAttachment({ kind: "image", url: IN }, { hasText: false })).toBe(true);
    expect(cleanableAttachment({ kind: "video", url: IN.replace(".jpg", ".mp4") }, { hasText: false })).toBe(true);
    expect(cleanableAttachment({ kind: "sticker", url: IN.replace(".jpg", ".webp") }, { hasText: false })).toBe(false);
    expect(cleanableAttachment({ kind: "document", url: IN.replace(".jpg", ".pdf") }, { hasText: false })).toBe(false);
    expect(cleanableAttachment({ kind: "image", url: OUT }, { hasText: false })).toBe(false);
    expect(cleanableAttachment({ kind: "image", url: null }, { hasText: false })).toBe(false);
  });

  it("un audio, solo con su texto (o si ya no se pudo transcribir)", () => {
    const audio = { kind: "audio", url: IN.replace(".jpg", ".ogg") };
    expect(cleanableAttachment(audio, { hasText: false })).toBe(false);
    expect(cleanableAttachment(audio, { hasText: true })).toBe(true);
    expect(cleanableAttachment({ ...audio, transcript: "hola" }, { hasText: false })).toBe(true);
    expect(cleanableAttachment({ ...audio, transcriptTries: 3 }, { hasText: false })).toBe(true);
    expect(cleanableAttachment({ ...audio, transcriptTries: 1 }, { hasText: false })).toBe(false);
  });

  it("después de borrar queda el texto, sin URL y con el motivo", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const out = cleanedAttachment({ kind: "audio", url: IN, transcript: "hola", caption: null }, now);
    expect(out).toEqual({ kind: "audio", url: null, transcript: "hola", caption: null, unavailableReason: "cleaned", cleanedAt: now.toISOString() });
  });
});
