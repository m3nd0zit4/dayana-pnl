/**
 * Lo puro de «Empezar limpio» (`ai-reset.ts`): qué se apaga, cómo se llama
 * cada motivo y la forma del plan. Aparte para que lo use la pantalla.
 */

/** Los básicos que ya dicen las reglas de la IA (y el flujo de primera vez). */
export const SUPERSEDED_PLAYBOOKS = ["Primer contacto", "Conversación de sanación", "Agendar", "Chat con conversación previa"];

export type ExampleReason = "ai_draft" | "auto_send" | "system" | "missing_message" | "not_work_chat" | "template";

export const EXAMPLE_REASON_LABEL: Record<ExampleReason, string> = {
  ai_draft: "borradores de la IA aprobados",
  auto_send: "envíos automáticos (masivos, recordatorios, bienvenida)",
  system: "avisos grises (llamadas, reacciones)",
  missing_message: "el mensaje ya no existe",
  not_work_chat: "chats personales, del equipo o de empresas",
  template: "textos pegados igual en muchos chats",
};

type Named = { id: string; name: string };

export type AiResetPlan = {
  /** Propuestas de procedimientos sin aprobar: se borran. */
  proposals: Named[];
  /** Básicos que ya están en las reglas: se apagan. */
  superseded: Named[];
  /** Procedimientos que mandaban a uno de los que se apagan: se les quita esa referencia. */
  textFixes: Named[];
  examples: { total: number; remove: number; byReason: Partial<Record<ExampleReason, number>> };
  memories: number;
  stickyModes: number;
  /** Se quedan como están (para que se vean antes de confirmar). */
  kept: {
    playbooks: string[];
    styleGuide: string;
    instructions: string;
    disabledExamples: number;
    /** Memorias que tocó alguien del equipo: son notas de Dayana, se quedan. */
    staffMemories: number;
    /** Chats en Copiloto porque alguien lo eligió: se quedan. */
    staffModes: number;
  };
};

export const normalizePlaybookName = (s: string) => s.trim().toLowerCase();
export const SUPERSEDED = new Set(SUPERSEDED_PLAYBOOKS.map(normalizePlaybookName));

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Quita « (sigue «Agendar»)» y parecidos, solo para los procedimientos que se apagan. */
export const withoutSupersededRefs = (steps: string, names: readonly string[] = SUPERSEDED_PLAYBOOKS): string => {
  if (names.length === 0) return steps;
  const re = new RegExp(`\\s*\\((?:sigue|ver) «(?:${names.map(escapeRe).join("|")})»\\)`, "g");
  return steps.replace(re, "");
};

