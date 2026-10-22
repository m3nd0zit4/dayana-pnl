import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { sureFirstName } from "@/lib/sure-name";
import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { isWhatsAppAutoReplyEnabled } from "../whatsapp-autoreply";
import { recipientFromContact, sendWhatsAppToRecipient } from "../whatsapp-outbound";
import { ensureTemplatesSubmitted } from "../whatsapp-templates";
import { chatNameInfo } from "./chat-name";
import { followUpDue, followUpText, QUOTE_FOLLOW_UP_SOURCE, QUOTE_STATE_LABEL, quoteSituation } from "./quote-follow-up-rules";
import { quoteLinesFor, quoteZoneFor } from "./quote-follow-up-view";
import { computeSegment } from "./segment-store";
import { GUARD_SELECT, waitingRoomBlocked } from "./waiting-room";

/**
 * El envío del seguimiento del cierre (reglas en `quote-follow-up-rules.ts`):
 * a quien Dayana ya le mandó cómo pagar y no ha pagado, la asistente le
 * escribe en orden (cotizada → 2 días; dijo una fecha → el día siguiente; el
 * 2º a los 4 días del 1º; dos como mucho).
 *
 * Solo a quien está en «tuvo la llamada» de verdad (el estado se recalcula
 * antes: si ya pagó o mandó un comprobante, no), con los mismos silencios que
 * la IA (`waitingRoomBlocked`: favorito, chat tomado, pausa, Manual, personal,
 * clienta) y el interruptor general. Dentro de las 24 h va como texto; fuera,
 * con la plantilla `seguimiento_proceso` (se manda sola a aprobar). Lo corre
 * el reloj (`tick.ts`, cada ≥ 15 min).
 */

const DAY = 24 * 3600_000;
export const QUOTE_TEMPLATE_KEY = "seguimiento_proceso";

/** Un mensaje de Dayana ella misma con cómo pagar, para buscar los chats (el detalle lo decide `quoteSituation`). */
const PAYMENT_HINTS = ["/pagar/", "comprobante", "western", "nequi", "bancolombia", "cuenta", "usd", "cop", "$"];

type Outcome = "sent" | "not_due" | "blocked" | "not_after_call" | "no_quote" | "no_phone" | "needs_template" | "failed";

type Send = typeof sendWhatsAppToRecipient;

const advance = async (conversationId: string, config: WhatsAppAiConfig, now: Date, send: Send): Promise<Outcome> => {
  const seg = await computeSegment(conversationId).catch(() => null);
  // Solo «tuvo la llamada», sin dudas de pago (comprobante por revisar, dice que pagó).
  if (!seg || seg.stage !== "tuvo_llamada" || seg.review) return "not_after_call";
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      ...GUARD_SELECT,
      contact: { select: { firstName: true, timezone: true, countryIso: true, phoneCountryIso: true } },
      dossier: { select: { segment: true, timezone: true } },
    },
  });
  if (!conv) return "no_quote";
  if (await waitingRoomBlocked(conv, config)) return "blocked";
  if (config.router.enabled && config.router.modes.after_call === "MANUAL" && !conv.aiAlwaysAt) return "blocked";
  // Un comprobante sin revisar: Dayana lo tiene que ver, no se le pide el pago otra vez.
  if (await prisma.whatsAppPaymentReceipt.count({ where: { conversationId, status: "pending" } })) return "blocked";

  const tz = await quoteZoneFor(conv);
  const lines = await quoteLinesFor(conversationId, config.quoteFollowUp.lookbackDays, now);
  const s = quoteSituation(lines, { now, tz, lookbackDays: config.quoteFollowUp.lookbackDays });
  if (!s) return "no_quote";
  const lastOutboundAt = [...lines].reverse().find((l) => l.direction === "OUTBOUND" && l.kind !== "system")?.sentAt ?? null;
  const due = followUpDue(s, config.quoteFollowUp, { now, tz, lastOutboundAt });
  if (!due) return "not_due";

  if (!/^\d{8,15}$/.test(conv.externalThreadId)) return "no_phone";
  const name = sureFirstName(await chatNameInfo(conversationId));
  const n = s.sent + 1;
  const r = await send({
    recipient: (conv.contactId ? await recipientFromContact(conv.contactId) : null) ?? {
      contactId: conv.contactId,
      phoneE164: `+${conv.externalThreadId}`,
      name: name ?? conv.participantName,
      optedOut: false,
    },
    text: followUpText(due.kind, s.state, name),
    templateKey: QUOTE_TEMPLATE_KEY,
    vars: { nombre: name ?? "" },
    // `recordatorio:`: sale solo, no cuenta como que Dayana contestó.
    source: `${QUOTE_FOLLOW_UP_SOURCE}${s.quoteAt.getTime()}:${n}`,
    isAutoReply: true,
    clientKey: `cotizacion:${conversationId}:${s.quoteAt.getTime()}:${n}`,
  }).catch((e: unknown) => ({ status: "failed" as const, error: e instanceof Error ? e.message : String(e) }));

  if (r.status === "skipped") return r.reason === "needs_template" ? "needs_template" : "no_phone";
  if (r.status !== "sent") {
    console.warn("[seguimiento cierre] no salió", conversationId, r.error);
    return "failed";
  }
  fireNotification({
    eventType: "WHATSAPP_AI_INFO",
    title: `Seguimiento a ${name ?? conv.participantName ?? `+${conv.externalThreadId}`} (${n}º)`,
    body: `${QUOTE_STATE_LABEL[s.state]}. Le escribí para iniciar su proceso.`,
    href: `/admin/whatsapp?conversation=${conversationId}`,
    entityType: "Conversation",
    entityId: conversationId,
    staff: "ALL",
  });
  return "sent";
};

/**
 * El reloj: los chats donde Dayana escribió ella misma algo de pagar en los
 * últimos días; para cada uno, el estado al día y, si le toca, el mensaje.
 * Como mucho `limit` envíos por pasada.
 */
export const sweepQuoteFollowUps = async (
  config: WhatsAppAiConfig,
  now = new Date(),
  /** Para las pruebas: sin enviar de verdad ni mirar el interruptor general. */
  opts: { limit?: number; send?: Send; conversationIds?: string[] } = {}
) => {
  const limit = opts.limit ?? 5;
  if (!config.quoteFollowUp.enabled || config.quoteFollowUp.max <= 0) return { off: true };
  if (!opts.send) {
    if (!(await isWhatsAppAutoReplyEnabled())) return { off: true, reason: "ai_off" };
    await ensureTemplatesSubmitted([QUOTE_TEMPLATE_KEY]).catch(() => undefined);
  }
  const since = new Date(now.getTime() - config.quoteFollowUp.lookbackDays * DAY);
  const rows = await prisma.conversationMessage.findMany({
    where: {
      direction: "OUTBOUND",
      isAutoReply: false,
      kind: "message",
      sentAt: { gte: since },
      OR: PAYMENT_HINTS.map((h) => ({ body: { contains: h, mode: "insensitive" as const } })),
      conversation: { channel: "WHATSAPP" },
      ...(opts.conversationIds ? { conversationId: { in: opts.conversationIds } } : {}),
    },
    distinct: ["conversationId"],
    select: { conversationId: true },
    take: 200,
  });
  const out: Record<string, number> = {};
  let sent = 0;
  for (const { conversationId } of rows) {
    if (sent >= limit) break;
    const r = await advance(conversationId, config, now, opts.send ?? sendWhatsAppToRecipient).catch((e: unknown) => {
      console.warn("[seguimiento cierre] no se pudo revisar", conversationId, e);
      return "failed" as const;
    });
    if (r === "sent") sent++;
    out[r] = (out[r] ?? 0) + 1;
  }
  return { checked: rows.length, ...out };
};
