import { describe, expect, test } from "bun:test";

import {
  buildDiagnosticAnswers,
  buildDiagnosticAnswersWith,
  type DiagnosticQuestionnaire,
} from "./diagnostic-answers";

/**
 * `buildDiagnosticAnswers` es pura, así que se prueba sin tocar Prisma.
 *
 * La mayoría de casos van contra el cuestionario real
 * (`lib/diagnostico/questions.ts`). Los tipos de pregunta que el cuestionario
 * real ya no tiene (`multi`, `scale`, `text`) se prueban con
 * `buildDiagnosticAnswersWith` y un cuestionario de prueba inyectado — sin
 * `mock.module`, que sustituiría el módulo real para todos los tests del
 * proceso.
 */

describe("buildDiagnosticAnswers — cuestionario real", () => {
  test("responde con la etiqueta y el hint de la opción elegida", () => {
    const items = buildDiagnosticAnswers({
      orientacion: "pesa",
      "foco-emocional": "ansiedad",
    });
    expect(items.find((i) => i.id === "foco-emocional")).toEqual({
      id: "foco-emocional",
      question: "¿Qué es lo que más te pesa hoy?",
      answers: ["Ansiedad y miedo"],
      hint: "La mente no para, el cuerpo tampoco",
    });
  });

  test("pregunta visible sin contestar: answers vacío, no se omite", () => {
    const tiempo = buildDiagnosticAnswers({ orientacion: "pesa" }).find(
      (i) => i.id === "tiempo",
    );
    expect(tiempo).toBeDefined();
    expect(tiempo?.answers).toEqual([]);
    expect(tiempo?.hint).toBeUndefined();
  });

  test("rama oculta por `orientacion`: la pregunta del otro track no aparece", () => {
    const items = buildDiagnosticAnswers({
      orientacion: "pesa",
      "foco-crecimiento": "habitos", // contestada igual, pero no se le llegó a mostrar
    });
    expect(items.some((i) => i.id === "foco-crecimiento")).toBe(false);
    expect(items.some((i) => i.id === "foco-emocional")).toBe(true);
  });

  test("la rama contraria se muestra cuando la condición cambia", () => {
    const items = buildDiagnosticAnswers({
      orientacion: "avanzar",
      "foco-crecimiento": "habitos",
    });
    expect(items.some((i) => i.id === "foco-emocional")).toBe(false);
    expect(items.find((i) => i.id === "foco-crecimiento")?.answers).toEqual([
      "Mis hábitos y mi disciplina",
    ]);
  });

  test("diagnóstico antiguo sin `orientacion`: no pinta las dos preguntas de foco vacías", () => {
    const sinNada = buildDiagnosticAnswers({ tiempo: "meses" });
    expect(sinNada.some((i) => i.id === "foco-emocional")).toBe(false);
    expect(sinNada.some((i) => i.id === "foco-crecimiento")).toBe(false);

    const conUna = buildDiagnosticAnswers({ "foco-emocional": "ansiedad" });
    expect(conUna.find((i) => i.id === "foco-emocional")?.answers).toEqual([
      "Ansiedad y miedo",
    ]);
    expect(conUna.some((i) => i.id === "foco-crecimiento")).toBe(false);
  });

  test("ids desconocidos o retirados del cuestionario se ignoran", () => {
    const items = buildDiagnosticAnswers({
      orientacion: "pesa",
      porqueDayana: ["algo-retirado"],
      preguntaFantasma: "x",
    });
    expect(items.some((i) => i.id === "porqueDayana")).toBe(false);
    expect(items.some((i) => i.id === "preguntaFantasma")).toBe(false);
  });

  test("el orden de salida respeta el orden del cuestionario", () => {
    const items = buildDiagnosticAnswers({
      cierre: "ya",
      orientacion: "pesa",
      modalidad: "individual",
      "foco-emocional": "ansiedad",
      tiempo: "meses",
    });
    expect(items.map((i) => i.id)).toEqual([
      "orientacion",
      "foco-emocional",
      "tiempo",
      "modalidad",
      "cierre",
    ]);
  });

  test("entrada que no es un objeto devuelve lista vacía", () => {
    expect(buildDiagnosticAnswers(null)).toEqual([]);
    expect(buildDiagnosticAnswers(undefined)).toEqual([]);
    expect(buildDiagnosticAnswers("no soy un diagnóstico")).toEqual([]);
    expect(buildDiagnosticAnswers(42)).toEqual([]);
  });
});

// -------------------------------------------------------------------------
// Contra un cuestionario de prueba, para las ramas `multi` / `scale` /
// `text` que el cuestionario real ya no usa.
// -------------------------------------------------------------------------

type FixtureAnswers = Partial<Record<string, string | string[]>>;

type FixtureQuestion = {
  id: string;
  prompt: string;
  type: "single" | "multi" | "scale" | "text";
  options?: { id: string; label: string; hint?: string }[];
};

const FIXTURE_QUESTIONS: FixtureQuestion[] = [
  {
    id: "solo-uno",
    prompt: "¿Cuál prefieres?",
    type: "single",
    options: [
      { id: "a", label: "Opción A", hint: "Pista de A" },
      { id: "b", label: "Opción B" },
    ],
  },
  {
    id: "varias",
    prompt: "¿Cuáles aplican?",
    type: "multi",
    options: [
      { id: "x", label: "Equis" },
      { id: "y", label: "Ye" },
      { id: "z", label: "Zeta" },
    ],
  },
  { id: "nivel", prompt: "¿Qué tan de acuerdo?", type: "scale" },
  { id: "comentario", prompt: "Cuéntame más", type: "text" },
];

const FIXTURE_BY_ID = new Map(FIXTURE_QUESTIONS.map((q) => [q.id, q]));

const fixtureQuestionnaire: DiagnosticQuestionnaire = {
  sanitizeAnswers(input: unknown): FixtureAnswers {
    if (typeof input !== "object" || input == null) return {};
    const out: FixtureAnswers = {};
    for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
      const question = FIXTURE_BY_ID.get(key);
      if (!question) continue;

      if (question.type === "text") {
        if (typeof raw === "string" && raw.trim()) out[key] = raw.trim();
        continue;
      }
      if (question.type === "scale") {
        const n = Number(raw);
        if (Number.isInteger(n) && n >= 1 && n <= 10) out[key] = String(n);
        continue;
      }
      const valid = new Set((question.options ?? []).map((o) => o.id));
      if (question.type === "multi") {
        if (Array.isArray(raw)) {
          const picked = raw.filter((v): v is string => typeof v === "string" && valid.has(v));
          if (picked.length) out[key] = picked;
        }
        continue;
      }
      if (typeof raw === "string" && valid.has(raw)) out[key] = raw;
    }
    return out;
  },
  // Sin `showIf` en el fixture: todas las preguntas de prueba son siempre visibles.
  visibleQuestions() {
    return FIXTURE_QUESTIONS;
  },
  answerLabels(questionId, value) {
    if (value == null) return [];
    const question = FIXTURE_BY_ID.get(questionId);
    const values = Array.isArray(value) ? value : [value];
    return values.map((v) => {
      if (!question) return v;
      if (question.type === "scale") return `${v}/10`;
      if (question.type === "text") return v;
      return question.options?.find((o) => o.id === v)?.label ?? v;
    });
  },
};

const fromFixture = (answers: unknown) =>
  buildDiagnosticAnswersWith(fixtureQuestionnaire, answers);

describe("buildDiagnosticAnswers — tipos de pregunta (fixture)", () => {
  test("selección múltiple: todas las etiquetas elegidas, sin hint", () => {
    const item = fromFixture({ varias: ["x", "z"] }).find((i) => i.id === "varias");
    expect(item?.answers).toEqual(["Equis", "Zeta"]);
    expect(item?.hint).toBeUndefined();
  });

  test("escala: se formatea como «n/10»", () => {
    const item = fromFixture({ nivel: "7" }).find((i) => i.id === "nivel");
    expect(item?.answers).toEqual(["7/10"]);
  });

  test("texto libre: se conserva tal cual", () => {
    const item = fromFixture({ comentario: "Quiero avanzar más rápido" }).find(
      (i) => i.id === "comentario",
    );
    expect(item?.answers).toEqual(["Quiero avanzar más rápido"]);
  });

  test("respuesta única con hint, dentro del mismo fixture", () => {
    const item = fromFixture({ "solo-uno": "a" }).find((i) => i.id === "solo-uno");
    expect(item?.answers).toEqual(["Opción A"]);
    expect(item?.hint).toBe("Pista de A");
  });
});
