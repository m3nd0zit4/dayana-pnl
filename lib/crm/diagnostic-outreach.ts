import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Prisma } from "@prisma/client";
import { generateObject } from "ai";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import { sanitizeAnswers } from "@/lib/diagnostico/questions";
import { buildDiagnosticSignals, countryName, describeSignals, type DiagnosticSignals } from "./diagnostic-signals";
import { getWhatsAppAiConfig, type WhatsAppAiConfig } from "./whatsapp-ai-config";
import { isWhatsAppAutoReplyEnabled, pauseAutoReply } from "./whatsapp-autoreply";
import { ensureWhatsAppConversation, recipientFromContact, sendWhatsAppToRecipient } from "./whatsapp-outbound";
import { approvedTemplateFor, ensureTemplatesSubmitted, refreshTemplatesIfPending, type WaTemplate } from "./whatsapp-templates";
import { proposeForApproval } from "./whatsapp-agent/approvals";
import { polishReply } from "./whatsapp-agent/wording";

/**
 * Autoevaluación → WhatsApp.
 *
 * Al terminar la autoevaluación, una IA la lee —qué contestó, desde dónde y a
 * qué hora de SU día— y le escribe a la persona por WhatsApp en ese momento,
 * con la voz de Dayana. Si algo indica que la persona está pasándola muy mal
 * (por ejemplo, un duelo de años contestado a las 3 a. m.), además se avisa a
 * Dayana como urgente y la IA se aparta de ese chat para que lo lleve ella.
 *
 * Es la primera vez que se le escribe, así que casi siempre va con plantilla
 * (fuera de la ventana de 24 h): `autoevaluacion_bienvenida` lleva el mensaje
 * personalizado; si aún no está aprobada, `seguimiento_diagnostico` (fija).
 */

export const OUTREACH_TEMPLATE_KEYS = ["autoevaluacion_bienvenida", "seguimiento_diagnostico"];

export type OutreachStatus =
  | "ANALYZING"
  | "SENT"
  | "AWAITING_APPROVAL"
  | "DRAFT"
  | "NEEDS_TEMPLATE"
  | "SKIPPED"
  | "FAILED";

const analysisSchema = z.object({
  feeling: z.string().describe("Cómo se está sintiendo probablemente, en 1–2 frases, sin diagnosticar."),
  insights: z.array(z.string()).describe("Lo más importante que Dayana debería saber."),
  timeContext: z
    .string()
    .describe("Qué sugiere la hora local y el lugar (madrugada, fin de semana, vive fuera…). Vacío si nada relevante."),
  care: z
    .enum(["normal", "atento", "urgente"])
    .describe("urgente = señales de sufrimiento agudo que Dayana debe ver ya; atento = cuidar el tono; normal = el resto."),
  careReason: z.string(),
  gender: z.enum(["femenino", "masculino", "desconocido"]).describe("Por el nombre; desconocido si no es claro."),
  message: z
    .string()
    .describe("El primer WhatsApp completo, con saludo y nombre."),
  templateMessage: z
    .string()
    .describe(
      "El mismo mensaje SIN el saludo ni el agradecimiento, en una sola línea: va después de «Hola {nombre}, te bendigo 💛 Gracias por hacer tu autoevaluación.»"
    ),
  suggestionForDayana: z.string().describe("Cómo abordarla si Dayana le escribe o la llama."),
});

export type DiagnosticAnalysis = z.infer<typeof analysisSchema> & {
  model: string | null;
  signals: Pick<
    DiagnosticSignals,
    "localTime" | "localWeekday" | "dayPart" | "lateNight" | "timezone" | "timezoneSource" | "livesIn" | "ipCity" | "phoneCountry" | "abroad"
  > & { livesInName: string | null };
  at: string;
};

const oneLine = (text: string) =>
  text
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

const firstNameOf = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "";

/** Sin clave de Gemini (o si falla): un mensaje sencillo, sin lectura. */
const fallbackAnalysis = (name: string, signals: DiagnosticSignals): z.infer<typeof analysisSchema> => ({
  feeling: "",
  insights: [],
  timeContext: signals.lateNight ? `Lo hizo de madrugada (${signals.localTime} hora local).` : "",
  care: signals.lateNight ? "atento" : "normal",
  careReason: signals.lateNight ? "Madrugada." : "",
  gender: "desconocido",
  message: `Hola${name ? ` ${name}` : ""}, te bendigo 💛 Gracias por hacer tu autoevaluación. Leí lo que compartiste y me gustaría escucharte. ¿Te regalo una consulta gratis de 15 minutos?`,
  templateMessage: "Leí lo que compartiste y me gustaría escucharte. ¿Te regalo una consulta gratis de 15 minutos?",
  suggestionForDayana: "",
});

export const analyzeDiagnostic = async (input: {
  name: string;
  signals: DiagnosticSignals;
  config: WhatsAppAiConfig;
  /** Días desde que la terminó (0 = ahora mismo). */
  daysAgo?: number;
}): Promise<z.infer<typeof analysisSchema> & { model: string | null }> => {
  if (!process.env.GEMINI_API_KEY?.trim()) return { ...fallbackAnalysis(input.name, input.signals), model: null };
  const modelName = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";
  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY?.trim() });
  const voice =
    input.config.identity === "owner"
      ? "Escribes COMO Dayana, en primera persona."
      : "Escribes de parte de Dayana (su asistente), cálida y cercana; Dayana es quien atiende.";
  const { object } = await generateObject({
    model: google(modelName),
    schema: analysisSchema,
    system: [
      "Eres quien acompaña a Dayana Beltrán, terapeuta y coach de PNL. Una persona acaba de terminar su autoevaluación en la web y le vas a escribir por WhatsApp en este momento, por primera vez.",
      "1) Lee sus respuestas, su perfil, desde dónde lo hizo y a qué hora de SU día. La hora dice mucho del ánimo: de madrugada (0–5 h) alguien que carga un duelo, ansiedad o algo de años probablemente no puede dormir por eso; un domingo en la noche pesa distinto que un martes a mediodía. Si vive fuera de su país (número de un país, conexión desde otro), la distancia puede ser parte de lo que siente.",
      "2) No diagnostiques ni uses etiquetas clínicas. «urgente» solo si las señales juntas hacen pensar en sufrimiento agudo (por ejemplo madrugada + duelo/ansiedad + años + quiere empezar ya); no por una sola señal.",
      `3) El mensaje: ${voice} Saluda con su nombre y «te bendigo 💛» (una sola vez). Máximo 3–4 frases cortas, como un WhatsApp real, sin listas ni negritas. Muestra que leíste lo que compartió en una frase empática, sin repetir sus respuestas como formulario. Invítala a una consulta gratis de 15 minutos con Dayana o a contarle un poco más; termina con una sola pregunta. Nada de precios ni enlaces. No digas que Dayana ya vio o leyó sus respuestas (todavía no): las leíste tú.`,
      "4) Si lo hizo de madrugada o en un momento difícil, puedes reconocerlo con delicadeza («a veces estas cosas pesan más en la noche»), pero NUNCA digas que ves su hora, su país o su ubicación: sería invasivo.",
      "5) Si care es «urgente», el mensaje es solo de cuidado y compañía (sin invitar a comprar nada) y dile que Dayana le escribe muy pronto.",
      "6) Género: si el nombre es masculino, nada de «mi bella», «querida» ni femeninos; si no es claro, usa formas neutras.",
      input.config.styleGuide ? `Así escribe Dayana:\n${input.config.styleGuide.slice(0, 2500)}` : "",
      input.config.instructions ? `Indicaciones de Dayana:\n${input.config.instructions.slice(0, 1500)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    prompt: [
      `Nombre: ${input.name || "(sin nombre)"}`,
      describeSignals(input.signals),
      input.daysAgo && input.daysAgo >= 1
        ? `La terminó hace ${input.daysAgo} día${input.daysAgo === 1 ? "" : "s"} y nadie le ha escrito todavía: el mensaje lo reconoce con naturalidad («hace unos días hiciste tu autoevaluación…»), sin disculparse de más. La lectura de la hora es la de cuando la hizo.`
        : "La acaba de terminar: le escribes en este momento.",
    ].join("\n"),
  });
  // Los límites van aquí y no en el esquema: si el modelo se pasa por unas
  // letras, se recorta; con el límite en el esquema se perdía la lectura entera.
  const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
  return {
    ...object,
    feeling: cut(object.feeling, 400),
    insights: object.insights.slice(0, 4).map((i) => cut(i, 200)),
    timeContext: cut(object.timeContext, 250),
    careReason: cut(object.careReason, 250),
    message: polishReply(object.message).slice(0, 900),
    templateMessage: oneLine(object.templateMessage).slice(0, 600),
    suggestionForDayana: cut(object.suggestionForDayana, 400),
    model: modelName,
  };
};

const pickTemplate = async (): Promise<WaTemplate | null> => {
  for (const key of OUTREACH_TEMPLATE_KEYS) {
    const t = await approvedTemplateFor(key);
    if (t) return t;
  }
  return null;
};

const setStatus = (id: string, status: OutreachStatus, reason: string | null, extra: Prisma.DiagnosticUpdateInput = {}) =>
  prisma.diagnostic.update({
    where: { id },
    data: { outreachStatus: status, outreachReason: reason?.slice(0, 300) ?? null, ...extra },
  });

const ownerIds = async (config: WhatsAppAiConfig): Promise<string[] | "ALL"> =>
  config.notify === "OWNERS"
    ? (
        await prisma.staffUser.findMany({ where: { role: "OWNER", isActive: true }, select: { id: true } })
      ).map((s) => s.id)
    : "ALL";

/**
 * Lee una autoevaluación con la IA y guarda la lectura (sin escribirle a
 * nadie). La usa el envío automático y el botón «Leer pendientes con IA».
 */
export const readDiagnostic = async (diagnosticId: string, config: WhatsAppAiConfig) => {
  const d = await prisma.diagnostic.findUniqueOrThrow({
    where: { id: diagnosticId },
    include: {
      contact: {
        select: { id: true, firstName: true, lastName: true, countryIso: true, timezone: true, phoneE164: true },
      },
    },
  });
  const contact = d.contact!;
  const signals = buildDiagnosticSignals({
    answers: sanitizeAnswers(d.answers),
    profile: d.profile,
    urgencyScore: d.urgencyScore,
    commitmentScore: d.commitmentScore,
    completedAt: d.completedAt ?? new Date(),
    phoneCountry: contact.countryIso,
    contactTimezone: contact.timezone,
    clientTimezone: d.clientTimezone,
    ipCountry: d.ipCountry,
    ipCity: d.ipCity,
    ipTimezone: d.ipTimezone,
  });
  const name = firstNameOf(contact.firstName);
  const daysAgo = Math.floor((Date.now() - (d.completedAt ?? new Date()).getTime()) / 86_400_000);
  const raw = await analyzeDiagnostic({ name, signals, config, daysAgo }).catch((e) => {
    console.error("[autoevaluacion] análisis", e);
    return { ...fallbackAnalysis(name, signals), model: null };
  });
  const analysis: DiagnosticAnalysis = {
    ...raw,
    signals: {
      localTime: signals.localTime,
      localWeekday: signals.localWeekday,
      dayPart: signals.dayPart,
      lateNight: signals.lateNight,
      timezone: signals.timezone,
      timezoneSource: signals.timezoneSource,
      livesIn: signals.livesIn,
      livesInName: countryName(signals.livesIn),
      ipCity: signals.ipCity,
      phoneCountry: signals.phoneCountry,
      abroad: signals.abroad,
    },
    at: new Date().toISOString(),
  };
  await prisma.diagnostic.update({
    where: { id: diagnosticId },
    data: { aiAnalysis: analysis as unknown as Prisma.InputJsonValue },
  });
  return { d, contact, signals, analysis, raw };
};

/** Lee con la IA las autoevaluaciones completas que aún no tienen lectura. */
export const readPendingDiagnostics = async (limit = 6): Promise<{ read: number; pending: number }> => {
  const config = await getWhatsAppAiConfig();
  const where: Prisma.DiagnosticWhereInput = {
    completedAt: { not: null },
    contactId: { not: null },
    aiAnalysis: { equals: Prisma.DbNull },
  };
  const rows = await prisma.diagnostic.findMany({
    where,
    orderBy: { completedAt: "desc" },
    take: limit,
    select: { id: true },
  });
  let read = 0;
  for (const r of rows) {
    await readDiagnostic(r.id, config)
      .then(() => read++)
      .catch((e) => console.error("[autoevaluacion] lectura", r.id, e));
  }
  return { read, pending: await prisma.diagnostic.count({ where }) };
};

/**
 * Lee la autoevaluación y le escribe a la persona. Se reclama una sola vez
 * por diagnóstico (salvo `force`, que es el botón «Escribirle ahora» del CRM:
 * ahí Dayana ya decidió y se envía sin pasar por la aprobación).
 */
export const runDiagnosticOutreach = async (
  diagnosticId: string,
  opts: { force?: boolean; staffId?: string | null } = {}
): Promise<{ status: OutreachStatus; reason?: string; conversationId?: string | null }> => {
  const config = await getWhatsAppAiConfig();
  if (!opts.force && !config.diagnosticOutreach.enabled) return { status: "SKIPPED", reason: "Apagado en Ajustes." };

  const claimed = await prisma.diagnostic.updateMany({
    where: {
      id: diagnosticId,
      completedAt: { not: null },
      contactId: { not: null },
      ...(opts.force ? {} : { outreachAt: null }),
    },
    data: { outreachAt: new Date(), outreachStatus: "ANALYZING", outreachReason: null },
  });
  if (claimed.count === 0) return { status: "SKIPPED", reason: "Ya se le escribió o no está completa." };

  try {
    const { d, contact, signals, analysis, raw } = await readDiagnostic(diagnosticId, config);

    const who = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Alguien";
    const diagHref = `/admin/diagnosticos/${diagnosticId}`;
    const staff = await ownerIds(config);
    const urgent = analysis.care === "urgente";

    const recipient = await recipientFromContact(contact.id);
    if (!recipient?.phoneE164 || recipient.optedOut) {
      await setStatus(diagnosticId, "SKIPPED", recipient?.optedOut ? "Pidió no recibir WhatsApp." : "Sin número de WhatsApp.");
      if (urgent) {
        fireNotification({
          eventType: "WHATSAPP_AI_ESCALATED",
          severity: "ERROR",
          title: `URGENTE — Autoevaluación de ${who}`,
          body: `${analysis.careReason} · No se le pudo escribir por WhatsApp.`,
          href: diagHref,
          entityType: "Diagnostic",
          entityId: diagnosticId,
          staff,
        });
      }
      return { status: "SKIPPED", reason: "Sin número." };
    }

    const conversation = await ensureWhatsAppConversation({
      phoneE164: recipient.phoneE164,
      contactId: contact.id,
      name: recipient.name,
    });
    const conv = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: { aiMode: true, priorityAt: true, _count: { select: { messages: true } } },
    });
    // Un chat que nace aquí arranca en el modo general, igual que uno entrante.
    let aiMode = conv.aiMode;
    if (conv._count.messages === 0 && aiMode !== config.defaultMode) {
      aiMode = config.defaultMode;
      await prisma.conversation.update({ where: { id: conversation.id }, data: { aiMode } });
    }
    await prisma.diagnostic.update({
      where: { id: diagnosticId },
      data: { outreachConversationId: conversation.id },
    });
    const chatHref = `/admin/whatsapp?conversation=${conversation.id}`;

    if (urgent) {
      // La IA se aparta: lo que conteste la persona lo lleva Dayana.
      await pauseAutoReply(conversation.id, "escalation", {
        category: "clinical",
        severity: "urgent",
        reason: `Autoevaluación: ${analysis.careReason}`,
      });
      fireNotification({
        eventType: "WHATSAPP_AI_ESCALATED",
        severity: "ERROR",
        title: `URGENTE — Autoevaluación de ${who} (${signals.localTime} hora local)`,
        body: `${analysis.feeling} ${analysis.careReason}`.trim().slice(0, 240),
        href: chatHref,
        entityType: "Conversation",
        entityId: conversation.id,
        staff,
      });
    }

    await refreshTemplatesIfPending().catch(() => undefined);
    const template = await pickTemplate();
    if (!template) {
      // Nadie la ha mandado a aprobar: se manda sola (no cuesta; se cobra el envío).
      await ensureTemplatesSubmitted(OUTREACH_TEMPLATE_KEYS).catch(() => undefined);
    }
    const vars = { mensaje: oneLine(analysis.templateMessage) };
    const aiEnabled = await isWhatsAppAutoReplyEnabled();

    // Chats que la IA no toca (favoritos, modo manual, IA apagada): queda de
    // borrador en el chat y se le avisa a Dayana.
    if (!opts.force && (conv.priorityAt || aiMode === "MANUAL" || !aiEnabled)) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { draftBody: analysis.message, draftSource: "AI", draftUpdatedAt: new Date() },
      });
      await setStatus(diagnosticId, "DRAFT", "Chat manual o favorito: quedó el borrador para Dayana.");
      if (!urgent) {
        fireNotification({
          eventType: "WHATSAPP_AI_INFO",
          title: `Autoevaluación de ${who}: mensaje listo`,
          body: analysis.feeling.slice(0, 200) || analysis.message.slice(0, 200),
          href: chatHref,
          entityType: "Conversation",
          entityId: conversation.id,
          staff,
        });
      }
      return { status: "DRAFT", conversationId: conversation.id };
    }

    const runMeta = {
      reason: "Autoevaluación completada",
      category: urgent ? "clinical" : null,
      severity: urgent ? "urgent" : null,
      model: raw.model,
      toolCalls: [{ name: "autoevaluacion", input: { diagnosticId }, output: { care: analysis.care } }],
    };

    if (!opts.force && (aiMode === "COPILOT" || config.diagnosticOutreach.requireApproval)) {
      const run = await prisma.whatsAppAiRun.create({
        data: { conversationId: conversation.id, status: "THINKING", startedAt: new Date(), ...runMeta },
      });
      await proposeForApproval({
        runId: run.id,
        conversationId: conversation.id,
        name: who,
        proposal: {
          kind: "reply",
          message: analysis.message,
          template: { keys: OUTREACH_TEMPLATE_KEYS, vars },
        },
      });
      await setStatus(diagnosticId, "AWAITING_APPROVAL", "Esperando que Dayana lo apruebe.");
      if (!urgent) {
        fireNotification({
          eventType: "WHATSAPP_AI_INFO",
          title: `Autoevaluación de ${who}: aprueba el primer mensaje`,
          body: analysis.feeling.slice(0, 200) || analysis.message.slice(0, 200),
          href: chatHref,
          entityType: "Conversation",
          entityId: conversation.id,
          staff,
        });
      }
      return { status: "AWAITING_APPROVAL", conversationId: conversation.id };
    }

    const result = await sendWhatsAppToRecipient({
      recipient,
      text: analysis.message,
      template,
      vars,
      source: "autoevaluacion",
      staffId: opts.staffId ?? null,
      // La escribió la IA (salvo que Dayana pulsara «Escribirle ahora»).
      isAutoReply: !opts.staffId,
      clientKey: `autoevaluacion:${diagnosticId}:${opts.force ? Date.now() : "auto"}`,
    });

    if (result.status === "sent") {
      // La escribió la IA (salvo que Dayana pulsara «Escribirle ahora»).
      await prisma.whatsAppAiRun.create({
        data: {
          conversationId: conversation.id,
          status: "REPLIED",
          startedAt: new Date(),
          finishedAt: new Date(),
          latencyMs: 0,
          ...runMeta,
        },
      });
      await setStatus(
        diagnosticId,
        "SENT",
        result.mode === "template" ? `Con la plantilla ${template?.key ?? ""}.` : "Texto libre (ya había escrito)."
      );
      return { status: "SENT", conversationId: conversation.id };
    }

    const reason =
      result.status === "skipped"
        ? result.reason === "needs_template"
          ? "Falta aprobar la plantilla «Después de la autoevaluación» (WhatsApp → Plantillas)."
          : "No se le puede escribir a este número."
        : result.error;
    const status: OutreachStatus =
      result.status === "skipped" && result.reason === "needs_template" ? "NEEDS_TEMPLATE" : "FAILED";
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { draftBody: analysis.message, draftSource: "AI", draftUpdatedAt: new Date() },
    });
    await setStatus(diagnosticId, status, reason);
    const waUrl = buildContactWhatsAppUrl(recipient.phoneE164, analysis.message);
    fireNotification({
      eventType: "WHATSAPP_AI_INFO",
      title: `Autoevaluación de ${who}: no se pudo escribir solo`,
      body: `${reason}${waUrl ? ` Escríbele desde el celular: ${waUrl}` : ""}`.slice(0, 400),
      href: diagHref,
      entityType: "Diagnostic",
      entityId: diagnosticId,
      staff,
    });
    return { status, reason, conversationId: conversation.id };
  } catch (e) {
    console.error("[autoevaluacion] outreach", e);
    await setStatus(diagnosticId, "FAILED", e instanceof Error ? e.message : String(e)).catch(() => undefined);
    return { status: "FAILED", reason: e instanceof Error ? e.message : String(e) };
  }
};

export { diagnosticContextFor } from "./diagnostic-context";
