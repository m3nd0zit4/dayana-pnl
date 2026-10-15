import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

import { personFullName } from "@/lib/person-name";

/**
 * El juez: un modelo lee el chat, lo que debía lograr la respuesta y lo que
 * contestó la asistente, y califica lo que el código no puede ver: si
 * respondió a lo que la persona dijo, si es coherente con lo anterior, el tono
 * y si dio el paso correcto. Sin referencia exacta (no hay una sola respuesta
 * buena): se juzga contra el objetivo del caso.
 */

const verdictSchema = z.object({
  responde: z.number().int().min(1).max(5).describe("¿Responde a lo ÚLTIMO que dijo la persona? 5 = sí, de lleno."),
  coherente: z.number().int().min(1).max(5).describe("¿Es coherente con todo lo anterior (no repite, no contradice, no olvida lo ya dicho)?"),
  tono: z.number().int().min(1).max(5).describe("Seria y cálida, de tú, corta; como asistente de Dayana (no como Dayana); sin apodos ni corazones."),
  paso: z.number().int().min(1).max(5).describe("¿Da el paso correcto según el objetivo del caso?"),
  objetivoCumplido: z.boolean(),
  problemas: z.array(z.string().max(160)).max(4).describe("Qué falla, concreto. Vacío si nada."),
});

export type Verdict = z.infer<typeof verdictSchema>;

export const judgeModelId = () =>
  process.env.GEMINI_JUDGE_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";

export const judgeReply = async (input: {
  transcript: { direction: "INBOUND" | "OUTBOUND"; body: string | null; attachment?: string | null }[];
  reply: string;
  outcome: string;
  goal: string;
  /** El nombre de su perfil de WhatsApp (puede no ser un nombre: «DIOS ES MI PROVEEDOR 🙏»). */
  name?: string | null;
}): Promise<Verdict> => {
  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY?.trim() });
  const chat = input.transcript
    .map((l) => `${l.direction === "INBOUND" ? "PERSONA" : "NOSOTRAS"}: ${l.attachment ? `[${l.attachment}] ` : ""}${l.body ?? ""}`)
    .join("\n");
  const { object } = await generateObject({
    model: google(judgeModelId()),
    schema: verdictSchema,
    temperature: 0,
    system: [
      "Evalúas a la asistente de WhatsApp de Dayana Beltrán (terapeuta y coach de PNL). La asistente habla de parte de Dayana: agenda la llamada gratis de 15 minutos (Dayana llama por WhatsApp), comparte datos de pago con una herramienta, recibe comprobantes y le pasa a Dayana lo delicado. Nunca da precios por chat.",
      "Califica con rigor y en concreto. Un 5 es una respuesta que Dayana enviaría tal cual. Penaliza: ignorar lo que la persona acaba de decir, repetir preguntas ya respondidas, saludar otra vez, mezclar pasos, hablar como si fuera Dayana, horas sin a. m./p. m., inventar datos, usar femenino o masculino con la persona sin que ella haya hablado de sí con género («cuando estés lista»).",
      "Si la asistente no le escribe («(no le escribe: se lo pasa a Dayana)»), juzga si pasárselo a Dayana sin mensaje era lo correcto.",
      "Estilo de Dayana (NO lo penalices): saluda y se despide con «te bendigo», habla de tú, cálida y espiritual; frases como «que tengas un bendecido día» son suyas.",
    ].join("\n"),
    prompt: `${nameNote(input.name)}CHAT HASTA AHORA:\n${chat}\n\nOBJETIVO DE ESTE CASO:\n${input.goal}\n\nLO QUE HIZO LA ASISTENTE (${input.outcome}):\n${input.reply}`,
  });
  return object;
};

/** Qué sabe el juez del nombre: un perfil que no es un nombre no se usa. */
const nameNote = (raw: string | null | undefined): string => {
  if (!raw?.trim()) return "";
  const full = personFullName(raw);
  return full
    ? `NOMBRE DE LA PERSONA (de su perfil de WhatsApp; usarlo está bien): ${full}\n\n`
    : `PERFIL DE WHATSAPP: «${raw.trim()}». No es un nombre de persona: la asistente NO debe llamar así a la persona (sí puede usar el nombre que dijo en el chat o preguntárselo).\n\n`;
};

/** Aprobado por el juez: todo 4 o más y el objetivo cumplido. */
export const judgePasses = (v: Verdict) => v.objetivoCumplido && Math.min(v.responde, v.coherente, v.tono, v.paso) >= 4;
