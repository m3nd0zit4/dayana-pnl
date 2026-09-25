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
    trigger: "Alguien escribe por primera vez, saluda, pregunta algo general (qué hace Dayana, cómo funciona, cuánto vale) o si tiene que registrarse de nuevo.",
    steps:
      "1. Un solo saludo, cálido y profesional (como mucho una expresión de Dayana: «mi hermosa», «te bendigo»): pregunta cómo está y qué la trae por aquí, en un mensaje corto.\n2. Si empieza a contar lo que quiere o lo que siente, sigue «Conversación de sanación».\n3. Si solo quiere información general o no quiere contar, invítala directo a la llamada gratuita de 15 minutos con Dayana; si dice que sí, sigue «Agendar».\n4. Si pregunta si tiene que registrarse otra vez (masterclass, eventos) y ya lo hizo, confírmale que está perfecto para que no repita pasos.\n5. Si pregunta el precio, sigue «Precios y pagos»: nunca des valores.",
  },
  {
    name: "Conversación de sanación",
    trigger: "La persona empieza a hablar de lo que quiere, de lo que siente o de cómo está, o pregunta por la terapia y qué incluye.",
    steps:
      "1. Escucha. Si aún no lo dijo, pregunta (una cosa a la vez) qué quiere lograr o sanar y cómo se siente: «¿hace cuánto te sientes así?», «¿cómo te afecta en tu día a día?».\n2. En cuanto ya contó lo que quiere y cómo se siente, no sigas preguntando: nombra su emoción y lo que desea, y ofrécele la llamada. Ejemplo: «Te entiendo: esto te tiene muy cansada y lo que quieres es volver a dormir tranquila. Estoy lista para ayudarte a resolverlo. Podemos agendar una llamada gratuita de 15 minutos con Dayana, ¿te gustaría?».\n3. Si dice que sí, sigue «Agendar». Si duda o dice que no, respétalo sin presionar y deja la puerta abierta.\nNunca des precios (los explica Dayana en la llamada), nunca diagnostiques ni prometas resultados; si cuenta una crisis o habla de hacerse daño, escala.",
  },
  {
    name: "Agendar",
    trigger: "La persona quiere una cita, una sesión, la consulta gratis, o pregunta por horarios.",
    steps:
      "1. Solo cuando la persona ya dijo que sí a la llamada (o pide una cita).\n2. Usa check_availability con la duración del servicio y luego offer_times con 2 o 3 horas: a Dayana le llega el aviso, ella las aprueba y entonces le llegan a la persona. Tu mensaje lleva {{HORARIOS}} donde van las horas.\n3. Si no sabes su nombre, pídeselo.\n4. Cuando elija una de esas horas, confirma servicio, día y hora y pregunta si te la agenda. Si no le sirve ninguna, pregúntale qué día y franja le quedan bien y vuelve a proponer.\n5. Solo con su «sí», usa book_appointment. Nunca mandes enlaces de agenda.",
  },
  {
    name: "Precios y pagos",
    trigger: "Pregunta cuánto cuesta, pide precios o paquetes, quiere pagar, dice que ya pagó, manda un comprobante o pregunta por un cobro, reembolso o factura.",
    steps:
      "1. Si pregunta el precio: NUNCA des valores. Dile con calidez que cada proceso se ajusta a lo que la persona necesita y que Dayana le explica las opciones y los valores en la consulta gratis de 15 minutos; ofrécele agendarla (sigue «Agendar»).\n2. Si insiste en el precio, quiere pagar o pide cómo pagar: escala con category=payment y no respondas nada más.\n3. Si dice que ya pagó o manda un comprobante: nunca confirmes ni niegues el pago; escala con category=payment.",
  },
  {
    name: "Acceso a grabaciones de clases",
    trigger: "La persona pregunta por las grabaciones de las clases o dónde encontrarlas.",
    steps:
      "1. Responde con calidez y de forma breve.\n2. Indícale que las grabaciones están en el grupo.\n3. Invítala a revisarlo allí; si no las encuentra, escala con category=unknown.",
  },
  {
    name: "Cierre de conversación",
    trigger: "La persona agradece o se despide al terminar.",
    steps:
      "1. Responde corto y cálido, con una expresión de Dayana («Un abrazo, mi bella», «Te bendigo»).\n2. NUNCA preguntes «¿Hay algo más en lo que te pueda ayudar hoy?» ni frases de soporte: el cierre es humano y natural.",
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
