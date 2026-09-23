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
    name: "Primer contacto",
    trigger: "Alguien escribe por primera vez, saluda o pregunta algo general (qué hace Dayana, cómo funciona, cuánto vale).",
    steps:
      "1. Saluda con calidez y pregunta cómo está y qué la trae.\n2. Una pregunta a la vez para que mire su situación: «¿hace cuánto te sientes así?», «¿cómo te afecta en tu día a día?», «¿cuánto tiempo más quieres seguir viviendo esto?».\n3. Refleja lo que cuenta en una frase, sin aconsejar.\n4. Invítala a la consulta gratis de 15 minutos con Dayana y ofrécele horas.\n5. No des precios de entrada; si los pide, ofrece primero la consulta gratis.",
  },
  {
    name: "Agendar",
    trigger: "La persona quiere una cita, una sesión, la consulta gratis, o pregunta por horarios.",
    steps:
      "1. Si no está claro, pregunta si es la consulta gratis de 15 minutos o una sesión, y si prefiere mañana o tarde.\n2. Usa check_availability con la duración de ese servicio y ofrece 2 o 3 opciones concretas.\n3. Si no sabes su nombre, pídeselo.\n4. Cuando elija, confirma servicio, día y hora y pregunta si te lo agenda.\n5. Solo con su «sí», usa book_appointment y comparte día, hora y el enlace de Meet. Nunca mandes enlaces de agenda.",
  },
  {
    name: "Pagos",
    trigger: "Pide cómo pagar un paquete, o menciona que ya pagó, manda un comprobante, pregunta por un cobro, reembolso o factura.",
    steps:
      "Si quiere pagar: usa payment_link con el paquete que eligió y comparte el enlace. Si dice que ya pagó o manda comprobante: nunca confirmes ni niegues el pago; llama a escalate con category=payment y no respondas nada más.",
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
