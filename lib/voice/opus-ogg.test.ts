import { describe, expect, test } from "bun:test";
import { oggCrc, opusPacketSamples } from "@/lib/audio/webm-to-ogg";
import { pcmFromBytes, pcmRateFromMime, pcmToOggOpus, resamplePcm } from "./opus-ogg";

const sine = (seconds: number, rate: number, hz = 220) =>
  Int16Array.from({ length: Math.round(seconds * rate) }, (_, i) => Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 8000));

/** Páginas Ogg: [granule, headerType, packet] de cada una, comprobando el CRC. */
const readPages = (ogg: Uint8Array) => {
  const pages: { granule: number; headerType: number; packet: Uint8Array }[] = [];
  let pos = 0;
  while (pos < ogg.length) {
    expect(String.fromCharCode(...ogg.slice(pos, pos + 4))).toBe("OggS");
    const view = new DataView(ogg.buffer, ogg.byteOffset + pos);
    const segs = ogg[pos + 26];
    const lacing = ogg.slice(pos + 27, pos + 27 + segs);
    const size = lacing.reduce((a, b) => a + b, 0);
    const len = 27 + segs + size;
    const page = ogg.slice(pos, pos + len);
    const stored = new DataView(page.buffer).getUint32(22, true);
    page.set([0, 0, 0, 0], 22);
    expect(oggCrc(page)).toBe(stored);
    pages.push({ granule: view.getUint32(6, true), headerType: ogg[pos + 5], packet: ogg.slice(pos + 27 + segs, pos + len) });
    pos += len;
  }
  return pages;
};

describe("pcmToOggOpus", () => {
  test("24 kHz PCM → valid Ogg/Opus with OpusHead, OpusTags and a final EOS page", () => {
    const { ogg, seconds } = pcmToOggOpus(sine(1.5, 24000), 24000);
    expect(seconds).toBeCloseTo(1.5, 2);
    const pages = readPages(ogg);
    expect(String.fromCharCode(...pages[0].packet.slice(0, 8))).toBe("OpusHead");
    expect(pages[0].packet[9]).toBe(1); // mono
    expect(String.fromCharCode(...pages[1].packet.slice(0, 8))).toBe("OpusTags");
    const audio = pages.slice(2);
    expect(audio.length).toBe(75); // 1.5 s / 20 ms
    expect(audio.every((p) => opusPacketSamples(p.packet) === 960)).toBe(true);
    expect(audio.at(-1)!.headerType).toBe(0x04);
    expect(audio.at(-1)!.granule).toBe(75 * 960);
  });

  test("an unsupported rate is resampled to 48 kHz", () => {
    const { seconds } = pcmToOggOpus(sine(0.5, 22050), 22050);
    expect(seconds).toBeCloseTo(0.5, 2);
  });

  test("no samples → throws", () => {
    expect(() => pcmToOggOpus(new Int16Array(0), 24000)).toThrow();
  });
});

describe("helpers", () => {
  test("pcmRateFromMime reads Gemini's mime type", () => {
    expect(pcmRateFromMime("audio/L16;codec=pcm;rate=24000")).toBe(24000);
    expect(pcmRateFromMime("audio/L16")).toBe(24000);
  });

  test("pcmFromBytes is little-endian and works on an unaligned view", () => {
    const raw = new Uint8Array([9, 0x01, 0x00, 0xff, 0xff]);
    expect(Array.from(pcmFromBytes(raw.subarray(1)))).toEqual([1, -1]);
  });

  test("resamplePcm halves the length from 48k to 24k", () => {
    expect(resamplePcm(new Int16Array(480), 48000, 24000).length).toBe(240);
  });
});
