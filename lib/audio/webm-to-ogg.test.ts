import { describe, expect, test } from "bun:test";

import { oggCrc, opusPacketSamples, readWebmOpus, webmToOgg } from "./webm-to-ogg";

/** Elemento EBML con tamaño de 8 bytes (o desconocido). */
const el = (id: number[], data: Uint8Array | number[], unknownSize = false): number[] => {
  const bytes = Array.from(data);
  const size = unknownSize
    ? [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
    : [0x01, 0, 0, 0, 0, 0, (bytes.length >> 8) & 0xff, bytes.length & 0xff];
  return [...id, ...size, ...bytes];
};

// Paquete Opus CELT de 20 ms (config 31 → toc 0xf8), un solo frame.
const packet = [0xf8, 1, 2, 3, 4];
const simpleBlock = (p: number[]) => el([0xa3], [0x81, 0x00, 0x00, 0x80, ...p]);

const webm = Uint8Array.from([
  ...el([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x86, 0x81, 0x01]),
  ...el(
    [0x18, 0x53, 0x80, 0x67],
    [
      ...el([0x16, 0x54, 0xae, 0x6b], el([0xae], el([0xe1], el([0x9f], [2])))),
      ...el([0x1f, 0x43, 0xb6, 0x75], [...simpleBlock(packet), ...simpleBlock(packet)], true),
    ],
    true
  ),
]);

describe("webm → ogg", () => {
  test("lee los paquetes Opus y los canales, con tamaños desconocidos (MediaRecorder)", () => {
    const parsed = readWebmOpus(webm);
    expect(parsed.channels).toBe(2);
    expect(parsed.packets).toHaveLength(2);
    expect(Array.from(parsed.packets[0])).toEqual(packet);
  });

  test("duración de un paquete por su TOC", () => {
    expect(opusPacketSamples(Uint8Array.from([0xf8]))).toBe(960); // 20 ms
    expect(opusPacketSamples(Uint8Array.from([0xfb, 0x03]))).toBe(2880); // 3 × 20 ms
  });

  test("escribe páginas Ogg válidas: OpusHead, OpusTags, audio con CRC correcto", () => {
    const ogg = webmToOgg(webm);
    const text = new TextDecoder("latin1").decode(ogg);
    expect(text.startsWith("OggS")).toBe(true);
    expect(text).toContain("OpusHead");
    expect(text).toContain("OpusTags");

    // Cada página: el CRC guardado coincide con el calculado con el campo en cero.
    let pos = 0;
    let pages = 0;
    let lastGranule = 0;
    while (pos < ogg.length) {
      const view = new DataView(ogg.buffer, ogg.byteOffset + pos);
      const segments = ogg[pos + 26];
      const lacing = ogg.slice(pos + 27, pos + 27 + segments);
      const size = 27 + segments + lacing.reduce((a, b) => a + b, 0);
      const page = ogg.slice(pos, pos + size);
      const stored = view.getUint32(22, true);
      new DataView(page.buffer).setUint32(22, 0, true);
      expect(oggCrc(page)).toBe(stored);
      lastGranule = view.getUint32(6, true);
      pos += size;
      pages++;
    }
    expect(pages).toBe(4);
    expect(lastGranule).toBe(1920);
  });
});
