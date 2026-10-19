import { describe, expect, test } from "bun:test";

import { defaultWhatsAppAiConfig, parseWhatsAppAiConfig } from "../whatsapp-ai-config";
import { applySpendLevel, estimateUsd, isOverBudget, SPEND_LEVELS, spendLimits } from "./spend";

describe("niveles de gasto", () => {
  test("por defecto «Completo»: lo de siempre (60 mensajes, 10 ejemplos, 5 viejos, 6 vueltas)", () => {
    const config = defaultWhatsAppAiConfig();
    expect(config.spend.level).toBe("completo");
    expect(spendLimits(config)).toEqual({ recentMessages: 60, examples: 10, snippets: 5, maxSteps: 6 });
  });

  test("una configuración guardada antes (sin «spend») queda en «Completo»", () => {
    expect(parseWhatsAppAiConfig(JSON.stringify({ identity: "assistant" })).spend).toEqual({ level: "completo", maxSteps: 6, dailyBudgetUsd: 0 });
  });

  test("cada nivel lee menos que el anterior", () => {
    const { ahorro, equilibrado, completo } = SPEND_LEVELS;
    for (const k of ["recentMessages", "examples", "snippets", "maxSteps"] as const) {
      expect(ahorro[k]).toBeLessThanOrEqual(equilibrado[k]);
      expect(equilibrado[k]).toBeLessThanOrEqual(completo[k]);
    }
    // Agendar necesita al menos ofrecer horas, agendar y contestar.
    expect(ahorro.maxSteps).toBeGreaterThanOrEqual(4);
  });

  test("«Personalizado» usa los números de Ajustes", () => {
    const config = defaultWhatsAppAiConfig();
    config.spend = { level: "personalizado", maxSteps: 5, dailyBudgetUsd: 0 };
    config.context.recentMessages = 30;
    config.context.snippets = 1;
    config.learning.examples = 4;
    expect(spendLimits(config)).toEqual({ recentMessages: 30, examples: 4, snippets: 1, maxSteps: 5 });
  });

  test("pasado el tope del día, «Ahorro»; sin tope, nunca", () => {
    const config = defaultWhatsAppAiConfig();
    expect(spendLimits(applySpendLevel(config, { overBudget: true }))).toEqual(SPEND_LEVELS.ahorro);
    expect(applySpendLevel(config, { overBudget: false })).toBe(config);
    expect(isOverBudget(0.6, 0.5)).toBe(true);
    expect(isOverBudget(0.4, 0.5)).toBe(false);
    expect(isOverBudget(99, 0)).toBe(false);
  });
});

describe("estimateUsd", () => {
  test("precio de lista de flash-lite: lo que estaba en caché al 10 %", () => {
    // 1 millón de entrada sin caché + 1 millón de salida.
    expect(estimateUsd({ inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(2.8, 5);
    // La misma entrada, toda en caché.
    expect(estimateUsd({ inputTokens: 1_000_000, cachedTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.03, 5);
  });
  test("una respuesta típica (19-oct): ~9.300 de entrada, 45 de salida", () => {
    expect(estimateUsd({ inputTokens: 9300, cachedTokens: 0, outputTokens: 45 })).toBeCloseTo(0.0029, 4);
  });
});
