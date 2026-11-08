import { describe, expect, test } from "bun:test";
import { synthesizeSpeech, TtsError } from "./tts";

const audioResponse = (samples: number[]) => {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((v, i) => view.setInt16(i * 2, v, true));
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.from(bytes).toString("base64") } }] } }],
    }),
    { status: 200 }
  );
};

describe("synthesizeSpeech", () => {
  test("sends only the text (no style instructions) and asks for AUDIO", async () => {
    let sent: { url: string; body: Record<string, unknown> } | null = null;
    const out = await synthesizeSpeech("Hola Dayana", {
      model: "tts-model",
      voice: "Kore",
      fetchImpl: async (url, init) => {
        sent = { url: String(url), body: JSON.parse(String(init?.body)) };
        return audioResponse([1, -2, 300]);
      },
    });
    expect(sent!.url).toContain("/models/tts-model:generateContent");
    expect(sent!.body).toEqual({
      contents: [{ role: "user", parts: [{ text: "Hola Dayana" }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      },
    });
    expect(Array.from(out.pcm)).toEqual([1, -2, 300]);
    expect(out.sampleRate).toBe(24000);
  });

  test("errors and blocks are reported, never an empty note", async () => {
    await expect(synthesizeSpeech("  ")).rejects.toBeInstanceOf(TtsError);
    await expect(
      synthesizeSpeech("x", { fetchImpl: async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 }) })
    ).rejects.toThrow("429: quota");
    await expect(
      synthesizeSpeech("x", { fetchImpl: async () => new Response(JSON.stringify({ promptFeedback: { blockReason: "OTHER" } }), { status: 200 }) })
    ).rejects.toThrow("bloqueó");
    await expect(
      synthesizeSpeech("x", { fetchImpl: async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }) })
    ).rejects.toThrow("no devolvió audio");
  });
});
