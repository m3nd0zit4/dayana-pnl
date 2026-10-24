import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { beforeEach, describe, expect, test } from "bun:test";

import { createGeminiFetch, geminiKeys, resetGeminiKeyState, type GeminiFetch } from "./gemini";

type Call = { url: string; key: string | null; body: unknown };

/** Un fetch de mentira: responde por clave. */
const fakeFetch = (byKey: Record<string, number | (() => Response)>) => {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = new Headers(init?.headers).get("x-goog-api-key");
    calls.push({ url: String(input), key, body: init?.body });
    const r = byKey[key ?? ""];
    if (typeof r === "function") return r();
    return new Response(JSON.stringify({ ok: r === 200 }), { status: r ?? 500 });
  }) as GeminiFetch;
  return { fn, calls };
};

const URL_ = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";
const init = { method: "POST", headers: { "x-goog-api-key": "A", "content-type": "application/json" }, body: '{"contents":[]}' };

beforeEach(() => resetGeminiKeyState());

describe("geminiKeys", () => {
  test("principal, la segunda y la lista, sin repetir ni vacías", () => {
    expect(geminiKeys({ GEMINI_API_KEY: " A ", GEMINI_API_KEY_2: "B", GEMINI_API_KEYS: "C, ,A,D" })).toEqual(["A", "B", "C", "D"]);
    expect(geminiKeys({})).toEqual([]);
  });
});

describe("respaldo de claves", () => {
  test("la principal sin créditos (402): la misma llamada sale con la segunda", async () => {
    const f = fakeFetch({ A: 402, B: 200 });
    const res = await createGeminiFetch({ keys: () => ["A", "B"], baseFetch: f.fn })(URL_, init);
    expect(res.status).toBe(200);
    expect(f.calls.map((c) => c.key)).toEqual(["A", "B"]);
    expect(f.calls[1].body).toBe(init.body);
  });

  test("la que falló por créditos queda de lado un rato: la siguiente llamada empieza por la que sirve", async () => {
    let t = 1_000_000;
    const f = fakeFetch({ A: 402, B: 200 });
    const gfetch = createGeminiFetch({ keys: () => ["A", "B"], baseFetch: f.fn, now: () => t });
    await gfetch(URL_, init);
    await gfetch(URL_, init);
    expect(f.calls.map((c) => c.key)).toEqual(["A", "B", "B"]);
    // Pasada la media hora, se vuelve a probar la principal (pudieron recargarla).
    t += 31 * 60_000;
    await gfetch(URL_, init);
    expect(f.calls.slice(-2).map((c) => c.key)).toEqual(["A", "B"]);
  });

  test("cuota (429) y clave bloqueada (403) también cambian de clave", async () => {
    for (const status of [429, 403]) {
      resetGeminiKeyState();
      const f = fakeFetch({ A: status, B: 200 });
      const res = await createGeminiFetch({ keys: () => ["A", "B"], baseFetch: f.fn })(URL_, init);
      expect(res.status).toBe(200);
    }
  });

  test("una clave inválida (400 API_KEY_INVALID) cambia; otro 400 (pedido mal hecho) no", async () => {
    const invalid = () => new Response('{"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}', { status: 400 });
    const f1 = fakeFetch({ A: invalid, B: 200 });
    expect((await createGeminiFetch({ keys: () => ["A", "B"], baseFetch: f1.fn })(URL_, init)).status).toBe(200);
    resetGeminiKeyState();
    const badRequest = () => new Response('{"error":{"status":"INVALID_ARGUMENT","message":"bad schema"}}', { status: 400 });
    const f2 = fakeFetch({ A: badRequest, B: 200 });
    expect((await createGeminiFetch({ keys: () => ["A", "B"], baseFetch: f2.fn })(URL_, init)).status).toBe(400);
    expect(f2.calls).toHaveLength(1);
  });

  test("un error del modelo (500) no gasta la otra clave", async () => {
    const f = fakeFetch({ A: 500, B: 200 });
    expect((await createGeminiFetch({ keys: () => ["A", "B"], baseFetch: f.fn })(URL_, init)).status).toBe(500);
    expect(f.calls).toHaveLength(1);
  });

  test("si todas fallan, llega el último error (y se prueban todas)", async () => {
    const f = fakeFetch({ A: 402, B: 429 });
    const res = await createGeminiFetch({ keys: () => ["A", "B"], baseFetch: f.fn })(URL_, init);
    expect(res.status).toBe(429);
    expect(f.calls.map((c) => c.key)).toEqual(["A", "B"]);
  });

  test("con una sola clave, la llamada pasa tal cual", async () => {
    const f = fakeFetch({ A: 402 });
    const res = await createGeminiFetch({ keys: () => ["A"], baseFetch: f.fn })(URL_, init);
    expect(res.status).toBe(402);
    expect(f.calls).toHaveLength(1);
  });
});

describe("pedido bloqueado por Google (200 sin candidates)", () => {
  // Andrea y Sil, 23/24-oct: Google contestó 200 solo con `promptFeedback` y el
  // SDK lanzaba «Invalid JSON response»; la IA no contestaba y se reintentaba sin fin.
  const blocked = () =>
    new Response(JSON.stringify({ promptFeedback: { blockReason: "OTHER" }, usageMetadata: { promptTokenCount: 900, totalTokenCount: 900 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const answer = (text: string) => () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason: "STOP" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  /** Responde por modelo (lo que va en la URL). */
  const byModel = (models: Record<string, () => Response>) => {
    const calls: string[] = [];
    const fn = (async (input: RequestInfo | URL) => {
      const model = /models\/([^:]+):/.exec(String(input))?.[1] ?? "";
      calls.push(model);
      return (models[model] ?? (() => new Response("{}", { status: 404 })))();
    }) as GeminiFetch;
    return { fn, calls };
  };

  test("se repite con el modelo sin «-lite» y llega esa respuesta", async () => {
    const f = byModel({ "gemini-3.5-flash-lite": blocked, "gemini-3.5-flash": answer("Hola, te bendigo") });
    const res = await createGeminiFetch({ keys: () => ["A"], baseFetch: f.fn })(URL_, init);
    expect(f.calls).toEqual(["gemini-3.5-flash-lite", "gemini-3.5-flash"]);
    expect((await res.json()).candidates[0].content.parts[0].text).toBe("Hola, te bendigo");
  });

  test("bloqueado también con el otro modelo: el SDK recibe una respuesta vacía con el motivo, no un error", async () => {
    const f = byModel({ "gemini-3.5-flash-lite": blocked, "gemini-3.5-flash": blocked });
    const google = createGoogleGenerativeAI({ apiKey: "A", fetch: createGeminiFetch({ keys: () => ["A"], baseFetch: f.fn }) as typeof fetch });
    const result = await generateText({ model: google("gemini-3.5-flash-lite"), prompt: "Si" });
    expect(result.text).toBe("");
    expect((result.providerMetadata?.google?.promptFeedback as { blockReason?: string } | null)?.blockReason).toBe("OTHER");
    expect(f.calls).toEqual(["gemini-3.5-flash-lite", "gemini-3.5-flash"]);
  });

  test("sin «-lite» no hay otro modelo: llega la respuesta vacía con el motivo", async () => {
    const f = byModel({ "gemini-3.5-flash": blocked });
    const url = URL_.replace("gemini-3.5-flash-lite", "gemini-3.5-flash");
    const body = await (await createGeminiFetch({ keys: () => ["A"], baseFetch: f.fn })(url, init)).json();
    expect(f.calls).toEqual(["gemini-3.5-flash"]);
    expect(body.candidates).toEqual([{ content: { parts: [] }, finishReason: "OTHER" }]);
    expect(body.promptFeedback.blockReason).toBe("OTHER");
  });

  test("una respuesta normal y lo que no es generateContent (embeddings) pasan tal cual", async () => {
    const f = byModel({ "gemini-3.5-flash-lite": answer("ok"), "gemini-embedding-001": () => new Response('{"embedding":{"values":[1]}}', { status: 200 }) });
    const gfetch = createGeminiFetch({ keys: () => ["A"], baseFetch: f.fn });
    expect((await (await gfetch(URL_, init)).json()).candidates[0].content.parts[0].text).toBe("ok");
    const embed = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";
    expect(await (await gfetch(embed, init)).json()).toEqual({ embedding: { values: [1] } });
    expect(f.calls).toEqual(["gemini-3.5-flash-lite", "gemini-embedding-001"]);
  });
});
