import { describe, expect, test } from "bun:test";

import { createGeminiFetch, resetGeminiKeyState } from "./gemini";
import { modelFromUrl, observeAiUsage, usageFromMetadata, usageFromResponseText, type AiUsage } from "./usage";

const URL_ = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";
const STREAM = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("uso de la IA", () => {
  test("el modelo sale de la dirección", () => {
    expect(modelFromUrl(URL_)).toBe("gemini-3.5-flash-lite");
    expect(modelFromUrl(STREAM)).toBe("gemini-3.5-flash");
    expect(modelFromUrl("https://example.com/otra-cosa")).toBeNull();
  });

  test("los tokens de una respuesta: lo pensado cuenta como salida, el audio aparte", () => {
    expect(
      usageFromMetadata("m", {
        promptTokenCount: 9300,
        cachedContentTokenCount: 6700,
        candidatesTokenCount: 45,
        thoughtsTokenCount: 120,
        totalTokenCount: 9465,
        promptTokensDetails: [
          { modality: "TEXT", tokenCount: 8980 },
          { modality: "AUDIO", tokenCount: 320 },
        ],
      }),
    ).toEqual({ model: "m", inputTokens: 9300, cachedTokens: 6700, audioTokens: 320, outputTokens: 165 });
  });

  test("sin recuento, o con ceros, no hay nada que anotar", () => {
    expect(usageFromMetadata("m", undefined)).toBeNull();
    expect(usageFromMetadata("m", {})).toBeNull();
    expect(usageFromMetadata("m", { promptTokenCount: "muchos" })).toBeNull();
  });

  test("respuesta normal y respuesta en trozos: vale el último recuento, no la suma", () => {
    expect(usageFromResponseText("m", JSON.stringify({ candidates: [], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } }))).toEqual({
      model: "m",
      inputTokens: 10,
      cachedTokens: 0,
      audioTokens: 0,
      outputTokens: 2,
    });

    const sse = [
      `data: ${JSON.stringify({ candidates: [{}], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 } })}`,
      "",
      `data: ${JSON.stringify({ candidates: [{}] })}`,
      "",
      `data: ${JSON.stringify({ candidates: [{}], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 7 } })}`,
      "",
      'data: {"candidates":[{}],"usageMetadata":{"promptTokenCount":10,"candi',
    ].join("\r\n");
    expect(usageFromResponseText("m", sse)?.outputTokens).toBe(7);
    expect(usageFromResponseText("m", "")).toBeNull();
    expect(usageFromResponseText("m", "{roto")).toBeNull();
  });

  test("mira una copia: quien pidió la respuesta la lee entera", async () => {
    const seen: AiUsage[] = [];
    const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: "hola" }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } });
    const res = new Response(body, { status: 200 });
    observeAiUsage(URL_, res, (u) => seen.push(u));
    expect(await res.text()).toBe(body);
    await tick();
    expect(seen).toEqual([{ model: "gemini-3.5-flash-lite", inputTokens: 5, cachedTokens: 0, audioTokens: 0, outputTokens: 1 }]);
  });

  test("no anota errores ni lo que no es una llamada al modelo", async () => {
    const seen: AiUsage[] = [];
    const usage = JSON.stringify({ usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } });
    observeAiUsage(URL_, new Response(usage, { status: 429 }), (u) => seen.push(u));
    observeAiUsage("https://generativelanguage.googleapis.com/v1beta/models", new Response(usage), (u) => seen.push(u));
    observeAiUsage(URL_, new Response(null, { status: 200 }), (u) => seen.push(u));
    await tick();
    expect(seen).toEqual([]);
  });

  test("el proveedor anota lo que devuelve, una vez, también si cambió de clave por el camino", async () => {
    resetGeminiKeyState();
    const seen: AiUsage[] = [];
    const calls: string[] = [];
    const answer = JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 30 } });
    const fetchWithUsage = createGeminiFetch({
      keys: () => ["A", "B"],
      onUsage: (u) => seen.push(u),
      baseFetch: async (_input, init) => {
        const key = new Headers(init?.headers).get("x-goog-api-key") ?? "";
        calls.push(key);
        return key === "A" ? new Response("{}", { status: 402 }) : new Response(answer, { status: 200 });
      },
    });

    const res = await fetchWithUsage(URL_, { method: "POST", body: "{}" });
    expect(await res.json()).toMatchObject({ usageMetadata: { promptTokenCount: 900 } });
    await tick();
    expect(calls).toEqual(["A", "B"]);
    expect(seen).toEqual([{ model: "gemini-3.5-flash-lite", inputTokens: 900, cachedTokens: 0, audioTokens: 0, outputTokens: 30 }]);
    resetGeminiKeyState();
  });

  test("si el «-lite» sale bloqueado y contesta el modelo completo, los tokens son del completo", async () => {
    resetGeminiKeyState();
    const seen: AiUsage[] = [];
    const blocked = JSON.stringify({ promptFeedback: { blockReason: "OTHER" }, usageMetadata: { promptTokenCount: 900, totalTokenCount: 900 } });
    const answer = JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 12 } });
    const withRetry = createGeminiFetch({
      keys: () => ["A"],
      onUsage: (u) => seen.push(u),
      baseFetch: async (input) => new Response(String(input).includes("-lite:") ? blocked : answer, { status: 200 }),
    });
    await (await withRetry(URL_, { method: "POST", body: "{}" })).text();
    await tick();
    expect(seen).toEqual([{ model: "gemini-3.5-flash", inputTokens: 900, cachedTokens: 0, audioTokens: 0, outputTokens: 12 }]);

    // Todo bloqueado: no llegó texto a nadie, no se anota nada.
    seen.length = 0;
    const allBlocked = createGeminiFetch({
      keys: () => ["A"],
      onUsage: (u) => seen.push(u),
      baseFetch: async () => new Response(blocked, { status: 200 }),
    });
    await (await allBlocked(URL_, { method: "POST", body: "{}" })).text();
    await tick();
    expect(seen).toEqual([]);
    resetGeminiKeyState();
  });

  test("sin `onUsage` el proveedor no toca la respuesta", async () => {
    const plain = createGeminiFetch({ keys: () => ["A"], baseFetch: async () => new Response("{}", { status: 200 }) });
    expect(await (await plain(URL_, { method: "POST", body: "{}" })).text()).toBe("{}");
  });
});
