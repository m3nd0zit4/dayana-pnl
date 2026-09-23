/**
 * Convierte una nota de voz grabada en el navegador (WebM con Opus, lo que
 * graba Chrome) a Ogg con Opus, que es lo que WhatsApp acepta y muestra como
 * nota de voz. No recodifica nada: saca los paquetes Opus del contenedor WebM
 * y los mete en páginas Ogg (RFC 7845). Sin dependencias ni WASM: corre en el
 * navegador antes de subir el archivo.
 */

// ── Lectura de WebM (EBML) ─────────────────────────────────────────────────

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Cluster: 0x1f43b675,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  CodecPrivate: 0x63a2,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  Channels: 0x9f,
  Audio: 0xe1,
} as const;

const MASTER = new Set<number>([ID.Segment, ID.Cluster, ID.Tracks, ID.TrackEntry, ID.BlockGroup, ID.Audio]);

type VInt = { value: number; length: number; unknown: boolean };

const readVint = (buf: Uint8Array, pos: number, keepMarker: boolean): VInt | null => {
  const first = buf[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || pos + length > buf.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === (0xff >> length);
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
};

export type WebmOpus = { codecPrivate: Uint8Array | null; channels: number; packets: Uint8Array[] };

export const readWebmOpus = (buf: Uint8Array): WebmOpus => {
  const out: WebmOpus = { codecPrivate: null, channels: 1, packets: [] };

  const walk = (start: number, end: number) => {
    let pos = start;
    while (pos < end) {
      const id = readVint(buf, pos, true);
      if (!id) return;
      const size = readVint(buf, pos + id.length, false);
      if (!size) return;
      const dataStart = pos + id.length + size.length;
      const dataEnd = size.unknown ? end : Math.min(end, dataStart + size.value);

      if (MASTER.has(id.value)) {
        walk(dataStart, dataEnd);
      } else if (id.value === ID.CodecPrivate) {
        out.codecPrivate = buf.slice(dataStart, dataEnd);
      } else if (id.value === ID.Channels) {
        out.channels = buf[dataStart] || 1;
      } else if (id.value === ID.SimpleBlock || id.value === ID.Block) {
        const track = readVint(buf, dataStart, false);
        if (track) {
          // número de pista + 2 bytes de tiempo + 1 byte de banderas; MediaRecorder no usa «lacing».
          const frameStart = dataStart + track.length + 3;
          if (frameStart < dataEnd) out.packets.push(buf.slice(frameStart, dataEnd));
        }
      }
      if (size.unknown && !MASTER.has(id.value)) return;
      pos = dataEnd;
    }
  };

  walk(0, buf.length);
  return out;
};

// ── Escritura de Ogg ───────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

export const oggCrc = (data: Uint8Array): number => {
  let crc = 0;
  for (let i = 0; i < data.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0;
  return crc >>> 0;
};

const oggPage = (packet: Uint8Array, opts: { headerType: number; granule: number; serial: number; sequence: number }) => {
  const segments: number[] = [];
  let remaining = packet.length;
  while (remaining >= 255) {
    segments.push(255);
    remaining -= 255;
  }
  segments.push(remaining);
  const header = new Uint8Array(27 + segments.length);
  const view = new DataView(header.buffer);
  header.set([0x4f, 0x67, 0x67, 0x53], 0); // OggS
  header[4] = 0;
  header[5] = opts.headerType;
  view.setUint32(6, opts.granule % 0x100000000, true);
  view.setUint32(10, Math.floor(opts.granule / 0x100000000), true);
  view.setUint32(14, opts.serial, true);
  view.setUint32(18, opts.sequence, true);
  view.setUint32(22, 0, true);
  header[26] = segments.length;
  header.set(segments, 27);
  const page = new Uint8Array(header.length + packet.length);
  page.set(header, 0);
  page.set(packet, header.length);
  new DataView(page.buffer).setUint32(22, oggCrc(page), true);
  return page;
};

/** Muestras (a 48 kHz) que trae un paquete Opus, según su byte TOC (RFC 6716). */
export const opusPacketSamples = (packet: Uint8Array): number => {
  if (packet.length === 0) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  const frameMs =
    config < 12 ? [10, 20, 40, 60][config % 4] : config < 16 ? [10, 20][config % 2] : [2.5, 5, 10, 20][config % 4];
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2;
  return Math.round(frames * frameMs * 48);
};

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

const opusHead = (channels: number) => {
  const head = new Uint8Array(19);
  const view = new DataView(head.buffer);
  head.set(ascii("OpusHead"), 0);
  head[8] = 1;
  head[9] = channels;
  view.setUint16(10, 312, true);
  view.setUint32(12, 48000, true);
  return head;
};

const opusTags = () => {
  const vendor = ascii("dayana-crm");
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  const view = new DataView(tags.buffer);
  tags.set(ascii("OpusTags"), 0);
  view.setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  view.setUint32(12 + vendor.length, 0, true);
  return tags;
};

export const opusToOgg = (input: WebmOpus, serial = 0x5eed1234): Uint8Array => {
  const head =
    input.codecPrivate && input.codecPrivate.length >= 19 && String.fromCharCode(...input.codecPrivate.slice(0, 8)) === "OpusHead"
      ? input.codecPrivate
      : opusHead(input.channels);
  const pages: Uint8Array[] = [
    oggPage(head, { headerType: 0x02, granule: 0, serial, sequence: 0 }),
    oggPage(opusTags(), { headerType: 0, granule: 0, serial, sequence: 1 }),
  ];
  let granule = 0;
  input.packets.forEach((packet, i) => {
    granule += opusPacketSamples(packet);
    const last = i === input.packets.length - 1;
    pages.push(oggPage(packet, { headerType: last ? 0x04 : 0, granule, serial, sequence: i + 2 }));
  });
  const total = pages.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of pages) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

/** WebM/Opus → Ogg/Opus. Lanza si el archivo no trae audio Opus legible. */
export const webmToOgg = (webm: Uint8Array): Uint8Array => {
  const parsed = readWebmOpus(webm);
  if (parsed.packets.length === 0) throw new Error("La grabación no trae audio.");
  return opusToOgg(parsed);
};
