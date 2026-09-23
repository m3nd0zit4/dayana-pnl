import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { BRAND, WHATSAPP_NUMBER } from "@/lib/contact";
import { getSiteSetting, setSiteSetting } from "./site-settings";
import { sendMetaMessage } from "@/lib/meta/send";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { getSiteUrl } from "@/lib/site-url";
import {
  getWhatsAppAiConfig,
  isWithinOwnerHours,
  type WhatsAppAiConfig,
} from "./whatsapp-ai-config";
import { findSimilarExamples, type SimilarExample } from "./whatsapp-learning";
import { getOperationalTimezone } from "./operational-timezone";

/**
 * Respuesta automática de WhatsApp.
 *
 * Contesta lo que se puede contestar con datos del CRM —qué hay, cuánto vale,
 * dónde se paga— y **para en seco** en cuanto la conversación deja de ser
 * informativa: dolor emocional fuerte, un problema con un cobro, una queja, o
 * cualquier cosa que no esté en los datos que se le dan. Entonces avisa al
 * panel y deja el hilo en manos de una persona.
 *
 * Tres barreras, y ninguna depende del modelo:
 *
 * 1. **Interruptor apagado por defecto.** Sin encenderlo en Ajustes → Canales
 *    no escribe nunca, aunque WhatsApp esté conectado.
 * 2. **Pausa por hilo** (`Conversation.aiPausedAt`). La pone la propia IA al
 *    escalar y cualquier mensaje escrito por el equipo. Un hilo pausado no se
 *    reanuda solo.
 * 3. **Tope por hilo y día.** Un bucle de dos robots hablándose, o un modelo
 *    que se emociona, cuesta dinero y credibilidad.
 *
 * El resto se configura en Ajustes → Asistente de WhatsApp
 * (`whatsapp-ai-config.ts`): a quién contesta, en qué horario, cómo se
 * presenta, instrucciones y estilo propios, y si usa respuestas reales de
 * Dayana como ejemplos (`whatsapp-learning.ts`).
 *
 * Lo que NUNCA hace, esté como esté el modelo: dar consejo clínico, diagnosticar,
 * prometer resultados, inventar precios o fechas, o pedir datos de pago.
 */

const ENABLED_KEY = "whatsapp.autoreply.enabled";

/** Apagado mientras nadie lo encienda: el silencio no puede ser un accidente. */
export const isWhatsAppAutoReplyEnabled = async (): Promise<boolean> =>
  (await getSiteSetting(ENABLED_KEY)) === "true";

export const setWhatsAppAutoReplyEnabled = (enabled: boolean): Promise<void> =>
  setSiteSetting(ENABLED_KEY, String(enabled));

/** Cuántos mensajes del hilo lee para entender de qué se habla. */
const HISTORY = 12;

const decision = z.object({
  action: z
    .enum(["reply", "escalate"])
    .describe(
      "`reply` solo si la respuesta sale de los DATOS. Si no, `escalate`."
    ),
  message: z
    .string()
    .max(700)
    .describe(
      "Lo que se le envía. En `escalate`, una línea avisando que Dayana responde."
    ),
  reason: z
    .string()
    .max(200)
    .describe("Por qué se escala. Lo lee el equipo, no la clienta."),
});

export type AutoReplyOutcome =
  | { status: "skipped"; reason: string }
  | { status: "replied" }
  | { status: "escalated"; reason: string };

const facts = async (): Promise<string> => {
  const site = getSiteUrl();

  const [products, workshop, webinar, magnets] = await Promise.all([
    prisma.product.findMany({
      // Misma regla que `isSellable` (lib/plans-from-db.ts): lo que de verdad
      // se puede comprar suelto. Con otro filtro la IA se quedaba sin precios
      // y escalaba hasta un «¿cuánto vale?».
      where: {
        isActive: true,
        OR: [{ isCourseContent: false }, { sellsStandalone: true }],
      },
      orderBy: { sortOrder: "asc" },
      select: {
        title: true,
        sessionsLabel: true,
        prices: {
          orderBy: { validFrom: "desc" },
          select: { currency: true, amountMinor: true },
        },
      },
      take: 12,
    }),
    prisma.workshopEdition.findFirst({
      where: { status: "OPEN" },
      orderBy: { startsAt: "asc" },
      select: { title: true, slug: true, dateLabel: true, scheduleLabel: true },
    }),
    prisma.freeWebinar.findFirst({
      where: { isActive: true, endedAt: null },
      select: { startsAt: true },
    }),
    prisma.keywordMagnet.findMany({
      where: { isActive: true },
      select: { label: true, title: true, keyword: true },
      take: 6,
    }),
  ]);

  const money = (currency: string, minor: number) =>
    currency === "COP"
      ? `${minor.toLocaleString("es-CO")} COP`
      : `${(minor / 100).toFixed(2)} USD`;

  const lines: string[] = [
    `Negocio: ${BRAND.name}, ${BRAND.tagline}. Sitio: ${site}`,
    `WhatsApp de Dayana: ${WHATSAPP_NUMBER}`,
    "",
    "PAQUETES ACTIVOS (precio exacto, no lo cambies ni lo redondees):",
    ...products.map((p) => {
      const price = p.prices
        .filter(
          (x, i, all) => all.findIndex((y) => y.currency === x.currency) === i
        )
        .map((x) => money(x.currency, x.amountMinor))
        .join(" · ");
      return `- ${p.title}${p.sessionsLabel ? ` (${p.sessionsLabel})` : ""}: ${price || "sin precio publicado"}`;
    }),
    "",
    `Para pagar cualquier terapia: ${site}/pagar/terapias`,
    `Cuestionario gratis (3 min, dice qué proceso le sirve): ${site}/terapias/empezar`,
  ];

  if (workshop) {
    lines.push(
      "",
      `TALLER ABIERTO: ${workshop.title}${workshop.dateLabel ? ` — ${workshop.dateLabel}` : ""}${
        workshop.scheduleLabel ? ` (${workshop.scheduleLabel})` : ""
      }. Página: ${site}/taller-virtual/${workshop.slug}`
    );
  }
  if (webinar?.startsAt) {
    lines.push("", `WEBINAR GRATIS: inscripción en ${site}/webinar-gratuito`);
  }
  if (magnets.length > 0) {
    lines.push(
      "",
      "MATERIALES GRATIS por palabra clave:",
      ...magnets.map(
        (m) => `- ${m.label}: ${m.title} → ${site}/material/${m.keyword}`
      )
    );
  }

  return lines.join("\n");
};

const IDENTITY: Record<WhatsAppAiConfig["identity"], string> = {
  assistant:
    "Escribes DE PARTE de Dayana, no eres ella: nunca digas «soy Dayana» ni hables como si fueras ella. Habla de Dayana en tercera persona («Dayana te responde», «ella revisa»). Tampoco te presentes como robot o inteligencia artificial salvo que te lo pregunten directamente; si te lo preguntan, dilo con naturalidad y escala.",
  owner:
    "Escribes en primera persona, con la voz de Dayana, porque es su número. Pero si la persona pregunta si habla con un robot, con una IA o con un asistente, NO lo niegues: di con naturalidad que es una respuesta automática y escala para que Dayana conteste en persona.",
};

const systemPrompt = (config: WhatsAppAiConfig): string => {
  const parts = [
    `Eres quien contesta el WhatsApp de ${BRAND.name}. Escribes como ella: cercana, en español, de tú, sin adornos ni emojis de más (uno como mucho). Mensajes cortos: 2 o 3 frases. Si más abajo hay una guía de estilo o ejemplos reales de Dayana, su forma de escribir manda sobre esta.

Tu trabajo es SOLO informar y orientar hacia el enlace correcto. No eres terapeuta.

Responde (action "reply") únicamente cuando la respuesta salga literal de los DATOS: qué paquetes hay, cuánto valen, cómo se paga, qué es el taller o el webinar, dónde está el material gratis, cómo funciona una sesión.

Escala (action "escalate") SIEMPRE que:
- la persona cuente un dolor emocional fuerte, una crisis, una pérdida, o pida ayuda psicológica;
- mencione hacerse daño o quitarse la vida — escala de inmediato y marca la razón como URGENTE;
- hable de un pago hecho, un cobro mal, un reembolso o una factura;
- pida agendar, cambiar o cancelar una cita concreta;
- se queje, reclame o esté molesta;
- pregunte algo que no esté en los DATOS, o pida un descuento;
- sea una conversación ya empezada con una persona del equipo.

${IDENTITY[config.identity]}

Al escalar, el mensaje es UNA línea, cálida y sin promesas de tiempo exacto: que Dayana lo lee y responde personalmente (en primera persona si escribes con su voz: «lo leo con calma y te respondo yo»).

Prohibido siempre: dar consejo clínico o diagnóstico, prometer resultados o curas, inventar precios, fechas, horarios o enlaces que no estén en los DATOS, pedir datos de tarjeta o contraseñas, y hablar de otra cosa que no sea este negocio.`,
  ];

  if (config.styleGuide) {
    parts.push(`CÓMO ESCRIBE DAYANA (imítalo):\n${config.styleGuide}`);
  }
  if (config.instructions) {
    parts.push(
      `INSTRUCCIONES DE DAYANA (cúmplelas, salvo que choquen con las prohibiciones de arriba):\n${config.instructions}`
    );
  }
  return parts.join("\n\n");
};

const examplesBlock = (examples: SimilarExample[]): string | null =>
  examples.length === 0
    ? null
    : [
        "EJEMPLOS REALES de cómo contestó Dayana a mensajes parecidos. Úsalos SOLO para el tono, el largo, el trato y las frases. Los precios, fechas, enlaces u ofertas que aparezcan en ellos pueden estar viejos: esos datos salen únicamente de los DATOS.",
        ...examples.map(
          (e, i) =>
            `#${i + 1}\nCLIENTA: ${e.clientText}\nDAYANA: ${e.replyText}`
        ),
      ].join("\n\n");

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY?.trim(),
});

export type ReplyDraft = z.infer<typeof decision> & {
  examples: SimilarExample[];
};

/**
 * Lo que la IA contestaría a esta conversación. No envía nada: lo usan la
 * respuesta automática y el botón «Probar» del panel, para que lo que Dayana
 * prueba sea exactamente lo que saldría.
 */
export const draftAutoReply = async (input: {
  config: WhatsAppAiConfig;
  transcript: { direction: "INBOUND" | "OUTBOUND"; body: string | null }[];
  name: string | null;
}): Promise<ReplyDraft> => {
  const lines = input.transcript.map(
    (m) =>
      `${m.direction === "INBOUND" ? "CLIENTA" : "NOSOTROS"}: ${m.body?.trim() ?? "(adjunto)"}`
  );

  // Lo último que escribió la persona, junto: es lo que se busca en los
  // ejemplos. Un fallo aquí no puede dejar a nadie sin respuesta.
  const lastInbound: string[] = [];
  for (const m of [...input.transcript].reverse()) {
    if (m.direction !== "INBOUND") break;
    if (m.body?.trim()) lastInbound.unshift(m.body.trim());
  }
  const examples = input.config.learning.enabled
    ? await findSimilarExamples(
        lastInbound.join("\n"),
        input.config.learning.examples
      ).catch((e) => {
        console.error("[whatsapp-autoreply] sin ejemplos", e);
        return [] as SimilarExample[];
      })
    : [];

  const { object } = await generateObject({
    model: google(process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"),
    schema: decision,
    system: systemPrompt(input.config),
    prompt: [
      `DATOS (lo único que puedes afirmar):\n${await facts()}`,
      examplesBlock(examples),
      input.name
        ? `La persona se llama ${input.name}.`
        : "No sabemos su nombre.",
      `CONVERSACIÓN:\n${lines.join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  return { ...object, examples };
};

/** Pausa el hilo: a partir de aquí contesta una persona. */
export const pauseAutoReply = async (conversationId: string): Promise<void> => {
  await prisma.conversation.updateMany({
    where: { id: conversationId, aiPausedAt: null },
    data: { aiPausedAt: new Date() },
  });
};

export const resumeAutoReply = async (
  conversationId: string
): Promise<void> => {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { aiPausedAt: null },
  });
};

/**
 * Contesta —o escala— el último mensaje entrante de un hilo de WhatsApp.
 *
 * Nunca lanza hacia fuera: esto corre detrás de un webhook de Meta, y un
 * fallo del modelo no puede hacer que el webhook responda error y Meta
 * reintente el mismo mensaje en bucle.
 */
export const maybeAutoReply = async (
  conversationId: string
): Promise<AutoReplyOutcome> => {
  try {
    if (!(await isWhatsAppAutoReplyEnabled())) {
      return { status: "skipped", reason: "disabled" };
    }
    if (!process.env.GEMINI_API_KEY?.trim()) {
      return { status: "skipped", reason: "no_model_key" };
    }

    const config = await getWhatsAppAiConfig();

    // En su horario contesta Dayana. No se pausa el hilo: fuera de horario la
    // IA puede volver a ayudar si nadie contestó.
    if (
      config.schedule.mode === "outside_hours" &&
      isWithinOwnerHours(
        config.schedule,
        new Date(),
        await getOperationalTimezone()
      )
    ) {
      return { status: "skipped", reason: "owner_hours" };
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        channel: true,
        aiPausedAt: true,
        assignedStaffId: true,
        externalThreadId: true,
        participantName: true,
        contact: {
          select: {
            firstName: true,
            enrollments: {
              where: { status: { in: ["ACTIVE", "COMPLETED"] } },
              select: { id: true },
              take: 1,
            },
          },
        },
        messages: {
          orderBy: { sentAt: "desc" },
          take: HISTORY,
          select: {
            direction: true,
            body: true,
            sentAt: true,
            isAutoReply: true,
            staffUserId: true,
            isEcho: true,
          },
        },
      },
    });

    if (!conversation) return { status: "skipped", reason: "not_found" };
    if (conversation.channel !== "WHATSAPP") {
      return { status: "skipped", reason: "other_channel" };
    }
    if (conversation.aiPausedAt) return { status: "skipped", reason: "paused" };
    if (conversation.assignedStaffId) {
      return { status: "skipped", reason: "assigned" };
    }

    const history = [...conversation.messages].reverse();
    const last = history.at(-1);
    if (!last || last.direction !== "INBOUND") {
      return { status: "skipped", reason: "no_inbound" };
    }
    if (!last.body?.trim()) {
      // Una foto o un audio sin texto: no hay nada que leer, y adivinar es
      // justo lo que no debe hacer.
      await pauseAutoReply(conversationId);
      return {
        status: "escalated",
        reason: "mensaje sin texto (audio o imagen)",
      };
    }

    // Alguien del equipo ya escribió aquí: el hilo es suyo.
    if (history.some((m) => m.staffUserId || (m.isEcho && !m.isAutoReply))) {
      await pauseAutoReply(conversationId);
      return { status: "skipped", reason: "human_replied" };
    }

    // A quién NO le contesta, según Ajustes. Con el número compartido, quien
    // ya conoce a Dayana (su libreta, o un chat donde ella ya escribió) no
    // debería recibir una respuesta automática.
    if (config.audience.skipKnownContacts) {
      const [inAddressBook, humanBefore] = await Promise.all([
        prisma.whatsAppKnownContact.count({
          where: { phone: conversation.externalThreadId, removedAt: null },
        }),
        prisma.conversationMessage.count({
          where: { conversationId, direction: "OUTBOUND", isAutoReply: false },
        }),
      ]);
      if (inAddressBook > 0 || humanBefore > 0) {
        return { status: "skipped", reason: "known_contact" };
      }
    }
    if (
      config.audience.skipCustomers &&
      (conversation.contact?.enrollments.length ?? 0) > 0
    ) {
      return { status: "skipped", reason: "customer" };
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const autoToday = await prisma.conversationMessage.count({
      where: { conversationId, isAutoReply: true, sentAt: { gte: since } },
    });
    if (autoToday >= config.maxPerDay) {
      await pauseAutoReply(conversationId);
      return {
        status: "escalated",
        reason: "demasiadas respuestas automáticas seguidas",
      };
    }

    const name =
      conversation.contact?.firstName?.trim() ||
      conversation.participantName?.trim() ||
      null;

    const object = await draftAutoReply({ config, transcript: history, name });

    const body = object.message.trim();
    if (!body) {
      await pauseAutoReply(conversationId);
      return { status: "escalated", reason: "el modelo no devolvió mensaje" };
    }

    if (object.action === "escalate") {
      await pauseAutoReply(conversationId);
      await sendAuto(conversationId, body);
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: "OPEN" },
      });
      fireNotification({
        eventType: "INBOX_MESSAGE_RECEIVED",
        title: `WhatsApp: te toca responder${name ? ` a ${name}` : ""}`,
        body: object.reason.slice(0, 200),
        href: `/admin/inbox?conversation=${conversationId}`,
        entityType: "Conversation",
        entityId: conversationId,
        staff: config.notify === "OWNERS" ? await ownerIds() : "ALL",
      });
      return { status: "escalated", reason: object.reason };
    }

    await sendAuto(conversationId, body);
    return { status: "replied" };
  } catch (e) {
    console.error("[whatsapp-autoreply] no se pudo responder", e);
    // Ante la duda, una persona: se pausa el hilo y se avisa.
    await pauseAutoReply(conversationId).catch(() => {});
    return { status: "skipped", reason: "error" };
  }
};

const ownerIds = async (): Promise<string[]> =>
  (
    await prisma.staffUser.findMany({
      where: { role: "OWNER", isActive: true },
      select: { id: true },
    })
  ).map((s) => s.id);

const sendAuto = async (conversationId: string, body: string) => {
  const result = await sendMetaMessage({ conversationId, body });
  await prisma.conversationMessage.update({
    where: { id: result.messageId },
    data: { isAutoReply: true },
  });
};
