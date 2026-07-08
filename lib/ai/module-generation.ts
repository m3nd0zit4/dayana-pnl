import { generateObject } from "ai";
import { z } from "zod";
import { getGeminiModel } from "./gemini";

const generationSchema = z.object({
  title: z.string().describe("Título del módulo, corto y claro"),
  bodyMd: z
    .string()
    .describe(
      "Contenido del módulo en Markdown: usa ## para encabezados, listas, negritas donde ayude a la claridad"
    ),
});

const SYSTEM_PROMPT = `Eres Dayana Beltrán, maestra en Programación Neurolingüística (PNL),
escribiendo el contenido de un módulo para su curso online. Te dan un tema o
esquema breve; genera el módulo completo. Reglas:
- Escribe en español, tono cercano, claro y profesional — como si le hablaras
  directo a la persona que toma el curso.
- Formato Markdown: empieza con un encabezado "## <tema>", usa subtítulos,
  listas y **negritas** donde ayuden a la claridad.
- Extensión: 300-700 palabras. Incluye al menos un ejercicio práctico o
  reflexión al final si el tema lo permite.
- No inventes datos biográficos ni promesas médicas — mantente en el terreno
  de herramientas y ejercicios de PNL/coaching.
- El título debe ser corto (máx 60 caracteres), sin comillas ni "Módulo N:".`;

export type GeneratedModuleContent = {
  title: string;
  bodyMd: string;
};

export const generateModuleContent = async (
  prompt: string
): Promise<GeneratedModuleContent> => {
  const { object } = await generateObject({
    model: getGeminiModel(),
    schema: generationSchema,
    system: SYSTEM_PROMPT,
    prompt,
  });

  return {
    title: object.title.trim().slice(0, 200),
    bodyMd: object.bodyMd.trim().slice(0, 20000),
  };
};
