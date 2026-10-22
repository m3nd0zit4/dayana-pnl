import { prisma } from "@/lib/db";
import { getOperationalTimezone } from "../operational-timezone";
import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { personZoneFor } from "./booking-time";
import { quoteSituation, type QuoteLine, type QuoteSituation } from "./quote-follow-up-rules";

/**
 * Leer en qué va el cierre de un chat (`quote-follow-up-rules.ts`), sin enviar
 * nada: lo usan el chat del CRM (`workspace.ts`) y el envío
 * (`quote-follow-up.ts`). Aparte del envío a propósito: `workspace.ts` no
 * puede traer `segment-store` → contactos → conversaciones (ese ciclo rompe
 * el paquete de `eve build`, como el 16-oct).
 */

const DAY = 24 * 3600_000;

/** Las líneas del chat de los últimos días (las 250 más nuevas, en orden), para las reglas (`QuoteLine`). */
export const quoteLinesFor = async (conversationId: string, lookbackDays: number, now = new Date()): Promise<QuoteLine[]> =>
  (
    await prisma.conversationMessage.findMany({
      where: { conversationId, sentAt: { gte: new Date(now.getTime() - (lookbackDays + 1) * DAY) }, status: { not: "FAILED" } },
      orderBy: { sentAt: "desc" },
      take: 250,
      select: { direction: true, body: true, sentAt: true, isAutoReply: true, source: true, clientKey: true, kind: true, attachments: true },
    })
  )
    .reverse()
    .map((m) => ({
    direction: m.direction === "INBOUND" ? "INBOUND" : "OUTBOUND",
    body: m.body,
    sentAt: m.sentAt,
    isAutoReply: m.isAutoReply,
    source: m.source,
    clientKey: m.clientKey,
    kind: m.kind,
    media: Array.isArray(m.attachments) && m.attachments.length > 0,
  }));

/** La zona de la persona (ficha, contacto de fiar o el país del número); si no, la de Dayana. */
export const quoteZoneFor = async (conv: {
  externalThreadId: string;
  contact: { timezone: string | null; countryIso: string | null; phoneCountryIso: string | null } | null;
  dossier: { timezone: string | null } | null;
}): Promise<string> =>
  personZoneFor({ dossierTz: conv.dossier?.timezone, contact: conv.contact, phone: conv.externalThreadId }) ?? (await getOperationalTimezone());

/** En qué va su cierre, para el chat del CRM (null: Dayana no le mandó cómo pagar en los últimos días). */
export const quoteFollowUpFor = async (
  conversationId: string,
  config: WhatsAppAiConfig,
  now = new Date()
): Promise<{ situation: QuoteSituation; tz: string } | null> => {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { externalThreadId: true, contact: { select: { timezone: true, countryIso: true, phoneCountryIso: true } }, dossier: { select: { timezone: true } } },
  });
  if (!conv) return null;
  const tz = await quoteZoneFor(conv);
  const situation = quoteSituation(await quoteLinesFor(conversationId, config.quoteFollowUp.lookbackDays, now), {
    now,
    tz,
    lookbackDays: config.quoteFollowUp.lookbackDays,
  });
  return situation ? { situation, tz } : null;
};
