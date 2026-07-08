import { generateObject } from "ai";
import { z } from "zod";
import { getGeminiModel } from "./gemini";

const scheduleSlotSchema = z.object({
  startTime: z
    .string()
    .nullable()
    .describe("Hora de inicio en formato 24h HH:MM, ej. 07:30"),
  endTime: z
    .string()
    .nullable()
    .describe("Hora de fin en formato 24h HH:MM, ej. 09:00"),
  title: z.string().nullable().describe("Actividad de ese bloque"),
});

const extractionSchema = z.object({
  title: z.string().nullable().describe("Título corto y llamativo del taller"),
  description: z
    .string()
    .nullable()
    .describe("Resumen tipo landing page, 1-2 frases"),
  editionLabel: z
    .string()
    .nullable()
    .describe('Etiqueta de edición, ej. "Edición mayo 2026"'),
  dateLabel: z
    .string()
    .nullable()
    .describe('Fecha en texto natural en español, ej. "16 de mayo de 2026"'),
  scheduleLabel: z
    .string()
    .nullable()
    .describe('Horario resumen, ej. "7:30 a.m. – 4:30 p.m. · virtual"'),
  focusTopics: z
    .array(z.string())
    .nullable()
    .describe("Temas de la jornada, frases cortas"),
  daySchedule: z
    .array(scheduleSlotSchema)
    .nullable()
    .describe("Cronograma del día, en orden"),
  introOpen: z
    .string()
    .nullable()
    .describe("Mensaje breve de invitación/CTA para inscribirse"),
});

const SYSTEM_PROMPT = `Eres el asistente del CRM de talleres de Dayana Beltrán (PNL).
Extrae los datos de un taller/jornada a partir de una descripción libre
(puede venir de WhatsApp, notas sueltas, o un boceto). Reglas:
- Devuelve null en todo campo que no aparezca o no puedas inferir con confianza. NUNCA inventes datos.
- title: corto, llamativo, sin comillas.
- daySchedule: horas SIEMPRE en formato 24h HH:MM (ej. "07:30", "16:00"), en el orden en que ocurren.
- focusTopics: frases cortas (máx 6 palabras cada una).
- Todo el texto en español.`;

export type ExtractedWorkshopFields = {
  title?: string;
  description?: string;
  editionLabel?: string;
  dateLabel?: string;
  scheduleLabel?: string;
  focusTopics?: string[];
  daySchedule?: { startTime: string; endTime: string; title: string }[];
  introOpen?: string;
};

export const extractWorkshopFields = async (
  text: string
): Promise<ExtractedWorkshopFields> => {
  const { object } = await generateObject({
    model: getGeminiModel(),
    schema: extractionSchema,
    system: SYSTEM_PROMPT,
    prompt: text,
  });

  const result: ExtractedWorkshopFields = {};

  const title = object.title?.trim();
  if (title) result.title = title.slice(0, 200);

  const description = object.description?.trim();
  if (description) result.description = description.slice(0, 1000);

  const editionLabel = object.editionLabel?.trim();
  if (editionLabel) result.editionLabel = editionLabel.slice(0, 120);

  const dateLabel = object.dateLabel?.trim();
  if (dateLabel) result.dateLabel = dateLabel.slice(0, 120);

  const scheduleLabel = object.scheduleLabel?.trim();
  if (scheduleLabel) result.scheduleLabel = scheduleLabel.slice(0, 160);

  const focusTopics = object.focusTopics
    ?.map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (focusTopics && focusTopics.length > 0) result.focusTopics = focusTopics;

  const daySchedule = object.daySchedule
    ?.filter(
      (s): s is { startTime: string; endTime: string; title: string } =>
        Boolean(s.startTime?.trim() && s.endTime?.trim() && s.title?.trim())
    )
    .map((s) => ({
      startTime: s.startTime.trim(),
      endTime: s.endTime.trim(),
      title: s.title.trim(),
    }));
  if (daySchedule && daySchedule.length > 0) result.daySchedule = daySchedule;

  const introOpen = object.introOpen?.trim();
  if (introOpen) result.introOpen = introOpen.slice(0, 500);

  return result;
};
