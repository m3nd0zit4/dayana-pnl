import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

import { prisma } from "@/lib/db";

/**
 * Procedimientos de la IA (las «skills» de Hermes Agent).
 *
 * Cada uno dice cuándo aplica y qué pasos seguir: cómo agendar, qué contestar
 * a «¿cuánto vale?», qué hacer con un comprobante. Se le pasan todos los
 * activos al modelo (son pocos y cortos) y él decide cuál aplica.
 *
 * Se mejoran solos, con Dayana de por medio: cuando ella corrige a la IA
 * —contesta encima de una respuesta automática, o edita un borrador antes de
 * enviarlo— `proposePlaybookFromCorrection` propone un cambio. La propuesta
 * nace apagada (`source: learned`, `isEnabled: false`) y solo cuenta cuando
 * Dayana la aprueba.
 */

export const playbookSchema = z.object({
  name: z.string().trim().min(2).max(80),
  trigger: z.string().trim().min(3).max(500),
  steps: z.string().trim().min(3).max(3000),
  isEnabled: z.boolean().optional(),
});

export type PlaybookRow = {
  id: string;
  name: string;
  trigger: string;
  steps: string;
  isEnabled: boolean;
  source: string;
  version: number;
  updatedAt: Date;
};

export const DEFAULT_PLAYBOOKS: { name: string; trigger: string; steps: string }[] = [
  {
    name: "Agendar",
    trigger: "La persona quiere una cita, una sesión o una llamada, o pregunta por horarios.",
    steps:
      "1. Si no está claro, pregunta qué quiere agendar (sesión o llamada) y si prefiere mañana o tarde.\n2. Usa check_availability con la duración de ese servicio y ofrece 2 o 3 opciones concretas (día y hora).\n3. Cuando elija una, confírmala: repite servicio, día y hora y pregunta si te la agenda.\n4. Solo con su «sí», usa book_appointment y comparte el día, la hora y el enlace de Meet.\n5. Si ninguna le sirve, pregunta qué día le queda mejor y vuelve a buscar. Nunca mandes enlaces de agenda.",
  },
  {
    name: "Pagos",
    trigger: "Menciona que pagó, transfirió, manda un comprobante, pregunta por un cobro, reembolso o factura.",
    steps:
      "Nunca confirmes ni niegues un pago. Llama a escalate con category=payment y no respondas nada más.",
  },
];

export const listPlaybooks = async (): Promise<PlaybookRow[]> =>
  prisma.whatsAppPlaybook.findMany({
    orderBy: [{ isEnabled: "desc" }, { name: "asc" }],
  });

/** Los procedimientos activos, en texto para el prompt. */
export const playbooksBlock = async (): Promise<string | null> => {
  let rows = await prisma.whatsAppPlaybook.findMany({
    where: { isEnabled: true },
    orderBy: { name: "asc" },
    select: { name: true, trigger: true, steps: true },
  });
  if (rows.length === 0) {
    // Nadie ha escrito ninguno todavía: los básicos, sin guardarlos (así
    // Dayana no encuentra filas que no creó).
    const any = await prisma.whatsAppPlaybook.count();
    if (any === 0) rows = DEFAULT_PLAYBOOKS;
  }
  if (rows.length === 0) return null;
  return [
    "PROCEDIMIENTOS (síguelos cuando la situación encaje con el «cuándo»):",
    ...rows.map((p) => `## ${p.name}\nCuándo: ${p.trigger}\nPasos:\n${p.steps}`),
  ].join("\n\n");
};

export const upsertPlaybook = async (input: {
  id?: string;
  name: string;
  trigger: string;
  steps: string;
  isEnabled?: boolean;
  source?: "manual" | "learned";
}): Promise<PlaybookRow> => {
  if (input.id) {
    return prisma.whatsAppPlaybook.update({
      where: { id: input.id },
      data: {
        name: input.name,
        trigger: input.trigger,
        steps: input.steps,
        ...(input.isEnabled === undefined ? {} : { isEnabled: input.isEnabled }),
        version: { increment: 1 },
      },
    });
  }
  return prisma.whatsAppPlaybook.create({
    data: {
      name: input.name,
      trigger: input.trigger,
      steps: input.steps,
      isEnabled: input.isEnabled ?? true,
      source: input.source ?? "manual",
    },
  });
};

/** Copia los básicos a la base para poder editarlos. Idempotente. */
export const seedDefaultPlaybooks = async (): Promise<void> => {
  if ((await prisma.whatsAppPlaybook.count()) > 0) return;
  await prisma.whatsAppPlaybook.createMany({ data: DEFAULT_PLAYBOOKS });
};

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY?.trim(),
});

/**
 * Dayana corrigió a la IA: ¿hay una regla que aprender?
 *
 * Devuelve la propuesta creada (apagada) o null si la corrección no enseña
 * nada general (un dato puntual de esa persona no es un procedimiento).
 */
export const proposePlaybookFromCorrection = async (input: {
  clientText: string;
  aiReply: string;
  dayanaReply: string;
}): Promise<PlaybookRow | null> => {
  if (!process.env.GEMINI_API_KEY?.trim()) return null;
  const existing = await prisma.whatsAppPlaybook.findMany({
    select: { id: true, name: true, trigger: true, steps: true },
  });
  const { object } = await generateObject({
    model: google(process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"),
    schema: z.object({
      general: z
        .boolean()
        .describe("true solo si la corrección enseña algo que aplica a otras personas."),
      updateId: z
        .string()
        .nullable()
        .describe("Id del procedimiento existente a mejorar, o null para uno nuevo."),
      name: z.string().max(60),
      trigger: z.string().max(300),
      steps: z.string().max(1500),
    }),
    system:
      "Eres el editor de los procedimientos del asistente de WhatsApp de una terapeuta. Te llega un caso donde la dueña corrigió al asistente. Si la corrección enseña una regla general (tono, un paso que faltó, algo que no se debe decir), propón el procedimiento nuevo o la versión mejorada de uno existente, en español y conciso. Si solo corrige un dato puntual de esa persona, general=false.",
    prompt: [
      `PROCEDIMIENTOS ACTUALES:\n${existing.map((p) => `[${p.id}] ${p.name}\nCuándo: ${p.trigger}\n${p.steps}`).join("\n\n") || "(ninguno)"}`,
      `MENSAJE DE LA PERSONA:\n${input.clientText}`,
      `LO QUE PROPUSO EL ASISTENTE:\n${input.aiReply}`,
      `LO QUE ESCRIBIÓ LA DUEÑA:\n${input.dayanaReply}`,
    ].join("\n\n"),
  });
  if (!object.general) return null;

  const base = object.updateId
    ? existing.find((p) => p.id === object.updateId)
    : undefined;
  // Una mejora a uno existente también nace como propuesta aparte: aprobarla
  // es decisión de Dayana, y el original sigue funcionando mientras tanto.
  return prisma.whatsAppPlaybook.create({
    data: {
      name: base ? `${base.name} (propuesta)` : object.name,
      trigger: object.trigger,
      steps: object.steps,
      isEnabled: false,
      source: "learned",
    },
  });
};
