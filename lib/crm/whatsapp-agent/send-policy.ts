import { prisma } from "@/lib/db";

import { isAutoSend } from "../whatsapp-attention-rules";

/**
 * La puerta única de los mensajes que salen solos (fase 1 de la arquitectura, dueña 21-nov:
 * «encuentra una arquitectura que no nos traiga este tipo de problemas»).
 *
 * Antes cada envío automático decidía por su cuenta y ninguno veía a los demás ni a Dayana:
 * a Kate y a Yanet les llegó «¿Pudiste hablar con Dayana?» 4–6 s después de que Dayana les
 * escribió; a Hugo «espérala 5 minutos» después de «ya hablé con ella»; a Manuel y a Leiner
 * «no lograron comunicarse» a las 3:48 a. m.; a Jm tres recordatorios y dos reagendamientos
 * seguidos. Ahora todos preguntan aquí, en el momento de enviar (no cuando se programaron),
 * con el chat leído de nuevo, y la respuesta sale de UNA tabla (`decideProactive`):
 *
 * | regla                                      | qué pasa                                  |
 * |--------------------------------------------|-------------------------------------------|
 * | Dayana o su equipo escribieron (30 min)    | espera (o no sale, si ya no tiene sentido)|
 * | la persona escribió hace < 3 min           | espera: la IA le está contestando         |
 * | otro mensaje automático hace < 10 min      | espera (no dos seguidos)                  |
 * | de noche en su zona (antes 8, desde 21 h)  | espera al día (lo que no es a una hora fija)|
 *
 * «Espera» = no sale ahora y el reloj vuelve a mirar (el envío suelta su reclamo); «no sale»
 * = se marca para no insistir. Lo que la persona pregunta lo contesta la IA con sus reglas:
 * esto es solo para lo que sale sin que nadie lo pida.
 */

/** Minutos que una conversación «es de Dayana» después de que ella escribe. */
export const HUMAN_ACTIVE_MIN = { proactive: 30, holding: 15 } as const;
/** Si la persona acaba de escribir, la IA le está contestando: nada automático encima. */
export const PERSON_JUST_WROTE_MIN = 3;
/** Entre dos mensajes automáticos al mismo chat. */
export const PROACTIVE_GAP_MIN = 10;
/** Horas del día (en su zona) en que sale lo que no es a una hora fija. */
export const DAY_HOURS = { from: 8, to: 21 } as const;

export type ProactiveKind =
  /** Recordatorio de la llamada gratis 24 h antes. */
  | "reminder_24h"
  /** Recordatorio 1 h antes («hoy a las…»). */
  | "reminder_1h"
  /** «¿Pudiste hablar con Dayana?» */
  | "call_check"
  /** «No lograron comunicarse… reagendemos» (automático, no el toque de Dayana). */
  | "reschedule"
  /** El seguimiento después de que Dayana le dijo cómo pagar. */
  | "quote_follow_up"
  /** «Dayana está terminando una reunión» que manda el reloj (no la respuesta a un mensaje). */
  | "waiting_room"
  /** La sesión de Meet sin la persona. */
  | "no_show"
  /** El primer mensaje después de la autoevaluación. */
  | "diagnostic";

/** Si Dayana está escribiendo: ¿espera o ya no tiene sentido? */
const ON_HUMAN: Record<ProactiveKind, "defer" | "skip"> = {
  reminder_24h: "defer",
  reminder_1h: "skip",
  call_check: "defer",
  reschedule: "defer",
  quote_follow_up: "defer",
  waiting_room: "skip",
  no_show: "skip",
  diagnostic: "skip",
};
/** A una hora fija (no espera al día, ni a que pase otro automático). */
const TIME_BOUND = new Set<ProactiveKind>(["reminder_24h", "reminder_1h", "waiting_room", "no_show"]);

export type GateLine = {
  direction: string;
  isAutoReply: boolean | null;
  source: string | null;
  clientKey: string | null;
  sentAt: Date;
  status?: string | null;
};

export type GateDecision = { action: "send" } | { action: "defer" | "skip"; why: string };

/** Lo escribió Dayana o su equipo (no la IA, no un envío automático, no una propuesta aprobada). */
const byHuman = (m: GateLine) => m.direction === "OUTBOUND" && !m.isAutoReply && m.source !== "approval" && !isAutoSend(m);
/** Un mensaje que salió solo (recordatorio, seguimiento, aviso del asistente…), no una respuesta. */
const proactive = (m: GateLine) =>
  m.direction === "OUTBOUND" &&
  (isAutoSend(m) || Boolean(m.source?.startsWith("asistente:")) || Boolean(m.clientKey?.startsWith("callcheck:")));

const hourIn = (now: Date, tz: string) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));

/** La tabla (pura). `recent`: los últimos mensajes del chat, en cualquier orden. */
export const decideProactive = (input: {
  kind: ProactiveKind;
  now: Date;
  personTz: string;
  recent: GateLine[];
  /** Solo las pruebas de punta a punta (corren a cualquier hora). */
  ignoreDayHours?: boolean;
}): GateDecision => {
  const now = input.now.getTime();
  const within = (m: GateLine, min: number) => m.sentAt.getTime() <= now && now - m.sentAt.getTime() < min * 60_000;
  const lines = input.recent.filter((m) => m.status !== "FAILED");
  if (lines.some((m) => byHuman(m) && within(m, HUMAN_ACTIVE_MIN.proactive))) {
    return { action: ON_HUMAN[input.kind], why: "Dayana o su equipo le escribieron hace menos de 30 min" };
  }
  if (lines.some((m) => m.direction === "INBOUND" && within(m, PERSON_JUST_WROTE_MIN))) {
    return { action: "defer", why: "la persona acaba de escribir: la IA le está contestando" };
  }
  if (!TIME_BOUND.has(input.kind) && lines.some((m) => proactive(m) && within(m, PROACTIVE_GAP_MIN))) {
    return { action: "defer", why: "otro mensaje automático salió hace menos de 10 min" };
  }
  if (!TIME_BOUND.has(input.kind) && !input.ignoreDayHours) {
    const h = hourIn(input.now, input.personTz);
    if (h < DAY_HOURS.from || h >= DAY_HOURS.to) return { action: "defer", why: "de noche en su zona" };
  }
  return { action: "send" };
};

const recentLines = (conversationId: string, now: Date) =>
  prisma.conversationMessage.findMany({
    where: { conversationId, kind: "message", sentAt: { gte: new Date(now.getTime() - 2 * 3600_000) } },
    orderBy: { sentAt: "desc" },
    take: 30,
    select: { direction: true, isAutoReply: true, source: true, clientKey: true, sentAt: true, status: true },
  });

/**
 * La puerta, leyendo el chat en este momento. Sin chat (un recordatorio a un número sin
 * conversación) no hay nada que mirar: sale. Si la base falla, espera (mejor tarde que encima).
 */
export const proactiveGate = async (input: {
  conversationId: string | null | undefined;
  kind: ProactiveKind;
  personTz: string;
  now?: Date;
}): Promise<GateDecision> => {
  if (!input.conversationId) return { action: "send" };
  const now = input.now ?? new Date();
  try {
    const decision = decideProactive({
      kind: input.kind,
      now,
      personTz: input.personTz,
      recent: await recentLines(input.conversationId, now),
      // Las pruebas de punta a punta (base de desarrollo) corren a cualquier hora.
      ignoreDayHours: process.env.E2E_IGNORE_DAY_HOURS === "1",
    });
    // Lo que la puerta frena queda en los registros (qué, a qué chat y por qué).
    if (decision.action !== "send") console.info(`[puerta] ${input.kind} ${decision.action} (${decision.why}) chat=${input.conversationId}`);
    return decision;
  } catch (e) {
    console.warn("[puerta] no se pudo leer el chat; espera", input.kind, e instanceof Error ? e.message : e);
    return { action: "defer", why: "no se pudo leer el chat" };
  }
};

/** Lo pura: ¿alguno de estos mensajes lo escribió Dayana o su equipo en los últimos `minutes`? */
export const humanWroteWithin = (messages: GateLine[], now: Date, minutes: number): boolean =>
  messages.some((m) => byHuman(m) && now.getTime() - m.sentAt.getTime() < minutes * 60_000 && m.sentAt.getTime() <= now.getTime());

/** ¿Dayana o su equipo le escribieron en los últimos `minutes`? (para el aviso de espera de una escalada). */
export const humanActive = async (conversationId: string, minutes: number, now = new Date()): Promise<boolean> => {
  const rows = await prisma.conversationMessage.findMany({
    where: {
      conversationId,
      direction: "OUTBOUND",
      kind: "message",
      status: { not: "FAILED" },
      sentAt: { gte: new Date(now.getTime() - minutes * 60_000) },
    },
    select: { direction: true, isAutoReply: true, source: true, clientKey: true, sentAt: true },
    take: 20,
  });
  return humanWroteWithin(rows, now, minutes);
};
