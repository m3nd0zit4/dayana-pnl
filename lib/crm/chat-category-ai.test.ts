import { APICallError } from "@ai-sdk/provider";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as realAi from "ai";

import type { CategoryMessage } from "./chat-category-rules";

/**
 * Sin red: `generateObject` simulado. Lo que se prueba es qué se le manda al
 * modelo, cómo se lee lo que devuelve y el cambio al modelo de respaldo.
 */
const calls: { model: string; prompt: string; thinking: unknown }[] = [];
let missingModels = new Set<string>();
/** Error que no es «el modelo no existe» (cuota, red…). */
let failWith: APICallError | null = null;
let reply: { category: string; confidence: number; reason: string } = {
  category: "interesada",
  confidence: 0.82,
  reason: "Pregunta el precio de la terapia",
};

mock.module("ai", () => ({
  ...realAi,
  generateObject: async (opts: {
    model: { modelId: string };
    prompt: string;
    providerOptions?: { google?: { thinkingConfig?: unknown } };
  }) => {
    calls.push({ model: opts.model.modelId, prompt: opts.prompt, thinking: opts.providerOptions?.google?.thinkingConfig });
    if (failWith) throw failWith;
    if (missingModels.has(opts.model.modelId)) {
      throw new APICallError({
        message: `models/${opts.model.modelId} is not found for API version v1beta`,
        url: "https://generativelanguage.googleapis.com",
        requestBodyValues: {},
        statusCode: 404,
      });
    }
    return { object: reply, usage: { inputTokens: 900, outputTokens: 30 } };
  },
}));

const ai = await import("./chat-category-ai");

const inb = (body: string | null, extra: Partial<CategoryMessage> = {}): CategoryMessage => ({
  direction: "INBOUND",
  body,
  ...extra,
});
const out = (body: string, extra: Partial<CategoryMessage> = {}): CategoryMessage => ({
  direction: "OUTBOUND",
  body,
  ...extra,
});

beforeEach(() => {
  calls.length = 0;
  missingModels = new Set();
  failWith = null;
  reply = { category: "interesada", confidence: 0.82, reason: "Pregunta el precio de la terapia" };
  ai.resetClassifierModelCache();
  process.env.GEMINI_API_KEY ||= "clave-de-prueba";
  delete process.env.GEMINI_CLASSIFIER_MODEL;
});

describe("transcriptForAi", () => {
  test("marca quién habla, los adjuntos y deja fuera los avisos grises", () => {
    const t = ai.transcriptForAi([
      out("Hoy es la masterclass 💛", { source: "bulk:abc" }),
      inb("Gracias!", { attachments: [{ kind: "sticker" }] }),
      inb("Reaccionó ❤️", { kind: "system" }),
      out("¿Te ayudo con algo?", { isAutoReply: true }),
      out("Hola, soy Dayana", { isEcho: true }),
      inb(null, { attachments: [{ kind: "image" }, { kind: "audio" }] }),
    ]);
    expect(t.split("\n")).toEqual([
      "DAYANA (envío masivo): Hoy es la masterclass 💛",
      "PERSONA: Gracias! [sticker]",
      "IA: ¿Te ayudo con algo?",
      "DAYANA: Hola, soy Dayana",
      "PERSONA: [foto] [audio]",
    ]);
  });

  test("solo los últimos 30 mensajes y ~4000 caracteres, recortando lo más viejo", () => {
    const many = Array.from({ length: 50 }, (_, i) => inb(`mensaje ${i} ${"x".repeat(300)}`));
    const t = ai.transcriptForAi(many);
    expect(t.length).toBeLessThanOrEqual(4000);
    expect(t.endsWith(`mensaje 49 ${"x".repeat(300)}`)).toBe(true);
    expect(t.includes("mensaje 19 ")).toBe(false);
  });
});

describe("classifyWithAi", () => {
  test("Flash-Lite con pensamiento mínimo, temperatura 0 y las pistas en el prompt", async () => {
    const r = await ai.classifyWithAi({
      messages: [inb("¿Cuánto cuesta la terapia?")],
      hints: ["Se inscribió a un evento gratuito de Dayana (masterclass / clase en vivo)."],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("gemini-3.5-flash-lite");
    expect(calls[0].thinking).toEqual({ thinkingLevel: "minimal" });
    expect(calls[0].prompt).toContain("- Se inscribió a un evento gratuito");
    expect(calls[0].prompt).toContain("PERSONA: ¿Cuánto cuesta la terapia?");
    expect(r).toMatchObject({ category: "interesada", confidence: 0.82, review: false, model: "gemini-3.5-flash-lite" });
    expect(r.inputTokens).toBe(900);
  });

  test("si el modelo no existe, responde el de respaldo y se recuerda", async () => {
    missingModels.add("gemini-3.5-flash-lite");
    const r1 = await ai.classifyWithAi({ messages: [inb("hola")], hints: [] });
    expect(r1.model).toBe("gemini-2.5-flash-lite");
    expect(calls.map((c) => c.model)).toEqual(["gemini-3.5-flash-lite", "gemini-2.5-flash-lite"]);
    expect(calls[1].thinking).toEqual({ thinkingBudget: 0 });
    await ai.classifyWithAi({ messages: [inb("hola")], hints: [] });
    expect(calls.map((c) => c.model)).toEqual([
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash-lite",
    ]);
  });

  test("GEMINI_CLASSIFIER_MODEL manda", async () => {
    process.env.GEMINI_CLASSIFIER_MODEL = "gemini-flash-lite-latest";
    await ai.classifyWithAi({ messages: [inb("hola")], hints: [] });
    expect(calls[0].model).toBe("gemini-flash-lite-latest");
  });

  test("poca confianza → revisar; confianza en % y motivo largo se normalizan", async () => {
    reply = { category: "otro", confidence: 55, reason: "a".repeat(200) };
    const r = await ai.classifyWithAi({ messages: [inb("hola")], hints: [] });
    expect(r.confidence).toBe(0.55);
    expect(r.review).toBe(true);
    expect(r.reason.length).toBe(120);
  });

  test("otro error (cuota, red) no cambia de modelo: se lanza", async () => {
    failWith = new APICallError({ message: "quota", url: "x", requestBodyValues: {}, statusCode: 429 });
    await expect(ai.classifyWithAi({ messages: [inb("hola")], hints: [] })).rejects.toThrow("quota");
    expect(calls.map((c) => c.model)).toEqual(["gemini-3.5-flash-lite"]);
  });

  test("sin clave no se llama al modelo", async () => {
    const key = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "";
    try {
      await expect(ai.classifyWithAi({ messages: [inb("hola")], hints: [] })).rejects.toThrow("NO_MODEL_KEY");
      expect(calls).toHaveLength(0);
    } finally {
      process.env.GEMINI_API_KEY = key;
    }
  });
});
