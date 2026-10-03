import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { APICallError, generateObject } from "ai";
import { z } from "zod";

import {
  CHAT_CATEGORIES,
  REVIEW_BELOW,
  type CategoryMessage,
  type ChatCategory,
} from "./chat-category-rules";

/**
 * Lo que las reglas no saben decidir, lo decide un modelo pequeño (Flash-Lite):
 * los últimos mensajes, marcados PERSONA / DAYANA / IA, y las pistas del CRM.
 * Cuesta centavos por cientos de chats. Si no está seguro (confianza < 0,7)
 * se guarda igual su mejor apuesta, marcada «revisar».
 */

/** Si el modelo configurado no existe en la cuenta, este responde. */
export const FALLBACK_CLASSIFIER_MODEL = "gemini-2.5-flash-lite";

export const classifierModelId = () => process.env.GEMINI_CLASSIFIER_MODEL?.trim() || "gemini-3.5-flash-lite";

/** El que respondió la última vez: si el configurado no existía, no se vuelve a probar en cada chat. */
let workingModel: string | null = null;

const MAX_MESSAGES = 30;
const MAX_CHARS = 4000;
const MAX_LINE = 400;

const ATTACHMENT_LABEL: Record<string, string> = {
  image: "foto",
  video: "video",
  audio: "audio",
  document: "documento",
  sticker: "sticker",
};

const BULK_SOURCES = ["bulk:", "recordatorio:", "evento:"];

const speaker = (m: CategoryMessage): string => {
  if (m.direction === "INBOUND" && !m.isEcho) return "PERSONA";
  if (m.isAutoReply) return "IA";
  if (m.source && BULK_SOURCES.some((p) => m.source!.startsWith(p))) return "DAYANA (envío masivo)";
  return "DAYANA";
};

const lineOf = (m: CategoryMessage): string | null => {
  if ((m.kind ?? "message") === "system") return null;
  const files = Array.isArray(m.attachments)
    ? m.attachments.map((a) => `[${ATTACHMENT_LABEL[String((a as { kind?: unknown })?.kind)] ?? "adjunto"}]`)
    : [];
  const text = (m.body ?? "").replace(/\s+/g, " ").trim();
  const content = [text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1)}…` : text, ...files].filter(Boolean).join(" ");
  return content ? `${speaker(m)}: ${content}` : null;
};

/**
 * La conversación para el modelo, de la más vieja a la más nueva: los últimos
 * 30 mensajes y no más de ~4000 caracteres (se recorta por arriba).
 * `messages` en orden cronológico.
 */
export const transcriptForAi = (messages: CategoryMessage[]): string => {
  const lines = messages.map(lineOf).filter((l): l is string => l !== null).slice(-MAX_MESSAGES);
  const kept: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (total + lines[i].length + 1 > MAX_CHARS) break;
    kept.unshift(lines[i]);
    total += lines[i].length + 1;
  }
  return kept.join("\n");
};

const SYSTEM = [
  "Clasificas chats de WhatsApp del número de trabajo de Dayana Beltrán, terapeuta y coach de PNL (terapia emocional, curso, talleres y masterclasses gratuitas). Lees la conversación y las pistas del CRM y eliges UNA categoría para la persona del chat:",
  "- cliente: ya le pagó a Dayana (terapia, curso, taller) o habla de sus sesiones pagadas, su paquete o su acceso al curso.",
  "- interesada: quiere o está considerando un servicio: pregunta precios, cómo es la terapia, cómo pagar, pide información, quiere agendar la consulta gratis, o cuenta un problema personal buscando ayuda.",
  "- comunidad: asistió o se inscribió a un evento gratuito (masterclass, clase en vivo) o está en la comunidad, y solo agradece, saluda, bendice, comenta la clase o pregunta cosas del evento (el link, la hora), sin pedir un servicio.",
  "- personal: familia, amigos o conocidos de Dayana: trato íntimo, planes, temas de la vida diaria que no son sobre sus servicios.",
  "- negocio: otra empresa, app o bot: códigos de verificación, notificaciones de bancos, apps o tiendas, respuestas automáticas, publicidad, spam, o alguien ofreciéndole servicios a Dayana (agencias, proveedores, marketing).",
  "- equipo: alguien que trabaja con Dayana (asistente, editor, community manager) hablando de tareas internas.",
  "- otro: no hay suficiente para decidir (un solo «hola», un audio sin texto) o no encaja en nada.",
  "",
  "Reglas:",
  "- Decide por lo que escribe PERSONA. DAYANA, DAYANA (envío masivo) e IA son el negocio: sus mensajes solo dan contexto (por ejemplo, una invitación a una masterclass).",
  "- Entre interesada y comunidad, elige interesada solo si la persona pide o pregunta por un servicio pagado o por la consulta.",
  "- Ejemplos: «Gracias Dayana, me encantó la masterclass 🙏» después de una invitación → comunidad. «¿Cuánto cuesta la terapia?» → interesada. «Gracias por comunicarte con Ferretería X, en breve te atenderemos» → negocio. «Tía, ¿vienes el domingo al almuerzo?» → personal. «Te paso el video editado para el reel de mañana» → equipo. Un «Hola» y nada más → otro con confianza baja.",
  "- confidence: 0.9 o más si es evidente, entre 0.7 y 0.9 si es probable, menos de 0.7 si es una suposición.",
  "- reason: en español, una frase concreta de máximo 120 caracteres («Pregunta el precio de la terapia»), sin nombres ni datos personales.",
].join("\n");

const schema = z.object({
  category: z.enum(CHAT_CATEGORIES),
  confidence: z.number(),
  reason: z.string(),
});

export type AiVerdict = {
  category: ChatCategory;
  confidence: number;
  reason: string;
  /** Confianza < 0,7: la pantalla lo marca «revisar». */
  review: boolean;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

/**
 * Google bloqueó el proyecto por facturación (403 «Lightning dunning decision
 * is deny…»): ningún modelo va a responder hasta que la dueña pague. No es un
 * fallo del chat: se deja sin clasificar y se reintenta en otra vuelta.
 */
export const isAiBillingBlocked = (e: unknown): boolean => {
  const err = (e as { lastError?: unknown })?.lastError ?? e;
  if (!APICallError.isInstance(err) || err.statusCode !== 403) return false;
  return /dunning|billing|facturaci/i.test(`${err.message} ${err.responseBody ?? ""}`);
};

const isModelNotFound = (e: unknown): boolean => {
  const err = (e as { lastError?: unknown })?.lastError ?? e;
  if (APICallError.isInstance(err)) {
    if (err.statusCode === 404) return true;
    return /not found|is not supported|unknown model|does not exist|invalid model/i.test(err.message);
  }
  return e instanceof Error && /models\/[\w.-]+ is not found|model not found/i.test(e.message);
};

/** Los modelos 3.x piensan por nivel; los 2.5, por presupuesto. Aquí, lo mínimo. */
const thinkingFor = (model: string) =>
  /^gemini-2/.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: "minimal" as const };

const callModel = async (model: string, prompt: string) => {
  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY?.trim() });
  return generateObject({
    model: google(model),
    schema,
    system: SYSTEM,
    prompt,
    temperature: 0,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(20_000),
    providerOptions: { google: { thinkingConfig: thinkingFor(model) } },
  });
};

const clampConfidence = (n: number): number => {
  if (!Number.isFinite(n)) return 0.5;
  const v = n > 1 && n <= 100 ? n / 100 : n;
  return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
};

/**
 * Pide la categoría al modelo. `messages` en orden cronológico; `hints`, las
 * pistas del CRM en una línea cada una. Lanza si no hay clave o el modelo falla.
 */
export const classifyWithAi = async (input: {
  messages: CategoryMessage[];
  hints: string[];
}): Promise<AiVerdict> => {
  if (!process.env.GEMINI_API_KEY?.trim()) throw new Error("NO_MODEL_KEY");
  const transcript = transcriptForAi(input.messages);
  const prompt = [
    `PISTAS DEL CRM:\n${input.hints.map((h) => `- ${h}`).join("\n") || "- (ninguna)"}`,
    `CONVERSACIÓN (lo más viejo arriba):\n${transcript || "(la persona no ha escrito nada)"}`,
  ].join("\n\n");

  const started = Date.now();
  const preferred = workingModel ?? classifierModelId();
  let model = preferred;
  let result: Awaited<ReturnType<typeof callModel>>;
  try {
    result = await callModel(model, prompt);
  } catch (e) {
    if (model === FALLBACK_CLASSIFIER_MODEL || !isModelNotFound(e)) throw e;
    console.warn(`[clasificar] el modelo ${model} no está disponible; uso ${FALLBACK_CLASSIFIER_MODEL}`);
    model = FALLBACK_CLASSIFIER_MODEL;
    result = await callModel(model, prompt);
  }
  workingModel = model;

  const confidence = clampConfidence(result.object.confidence);
  const reason = result.object.reason.replace(/\s+/g, " ").trim();
  return {
    category: result.object.category,
    confidence,
    reason: (reason.length > 120 ? `${reason.slice(0, 119).trimEnd()}…` : reason) || "Lo decidió la IA",
    review: confidence < REVIEW_BELOW,
    model,
    latencyMs: Date.now() - started,
    inputTokens: result.usage?.inputTokens ?? null,
    outputTokens: result.usage?.outputTokens ?? null,
  };
};

/** Para las pruebas: olvida qué modelo respondió. */
export const resetClassifierModelCache = () => {
  workingModel = null;
};
