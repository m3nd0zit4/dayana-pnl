import OpusScript from "opusscript";
import { opusToOgg } from "@/lib/audio/webm-to-ogg";

/**
 * PCM (16 bits, mono) → Ogg/Opus, lo único que WhatsApp muestra como nota de
 * voz (`audio` con `voice: true`). Gemini TTS devuelve PCM crudo a 24 kHz; el
 * codificador es libopus compilado a JS/WASM (`opusscript`, sin binarios
 * nativos, corre en una función de Vercel) y el contenedor Ogg es el mismo que
 * ya arma `webm-to-ogg.ts` para las notas grabadas en el navegador.
 */

const OPUS_RATES = [8000, 12000, 16000, 24000, 48000] as const;
type OpusRate = (typeof OPUS_RATES)[number];

/** `audio/L16;codec=pcm;rate=24000` → 24000. Gemini lo dice en el `mimeType`. */
export const pcmRateFromMime = (mime: string | null | undefined, fallback = 24000): number => {
  const m = mime?.match(/rate=(\d+)/i);
  return m ? Number(m[1]) : fallback;
};

/** Interpolación lineal a una frecuencia que Opus acepta (solo si hace falta). */
export const resamplePcm = (pcm: Int16Array, from: number, to: number): Int16Array => {
  if (from === to) return pcm;
  const ratio = from / to;
  const out = new Int16Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const a = Math.floor(pos);
    const b = Math.min(a + 1, pcm.length - 1);
    out[i] = Math.round(pcm[a] + (pcm[b] - pcm[a]) * (pos - a));
  }
  return out;
};

/** Bytes little-endian de 16 bits → muestras (copia: el buffer de origen puede no estar alineado). */
export const pcmFromBytes = (bytes: Uint8Array): Int16Array => {
  const n = Math.floor(bytes.length / 2);
  const out = new Int16Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true);
  return out;
};

export const pcmToOggOpus = (
  pcm: Int16Array,
  sampleRate: number,
  opts: { bitrate?: number } = {}
): { ogg: Uint8Array; seconds: number } => {
  const rate: OpusRate = (OPUS_RATES as readonly number[]).includes(sampleRate) ? (sampleRate as OpusRate) : 48000;
  const samples = rate === sampleRate ? pcm : resamplePcm(pcm, sampleRate, rate);
  const frame = (rate / 1000) * 20; // 20 ms
  // asm.js y no WASM: el WASM de opusscript se carga con `fs` relativo a su
  // carpeta, que el empaquetado de Next/eve no siempre copia. Para notas de
  // pocos segundos la diferencia de velocidad no importa.
  const encoder = new OpusScript(rate, 1, OpusScript.Application.VOIP, { wasm: false });
  try {
    encoder.setBitrate(opts.bitrate ?? 24000);
    const packets: Uint8Array[] = [];
    const buf = Buffer.alloc(frame * 2);
    for (let start = 0; start < samples.length; start += frame) {
      buf.fill(0);
      const end = Math.min(start + frame, samples.length);
      for (let i = start; i < end; i++) buf.writeInt16LE(samples[i], (i - start) * 2);
      packets.push(new Uint8Array(encoder.encode(buf, frame)));
    }
    if (packets.length === 0) throw new Error("No hay audio para codificar.");
    return { ogg: opusToOgg({ codecPrivate: null, channels: 1, packets }), seconds: samples.length / rate };
  } finally {
    encoder.delete();
  }
};
