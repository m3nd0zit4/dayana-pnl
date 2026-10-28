import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { sureFirstName } from "@/lib/sure-name";
import { sanitizeMensaje } from "../event-template-vars";
import type { WhatsAppAiConfig } from "../whatsapp-ai-config";
import { isWhatsAppAutoReplyEnabled } from "../whatsapp-autoreply";
import { recipientFromContact, sendWhatsAppToRecipient } from "../whatsapp-outbound";
import { fillVars } from "../whatsapp-outbound-plan";
import { approvedTemplateFor, ensureTemplatesSubmitted } from "../whatsapp-templates";
import { enrolledInWorkshop, openWorkshopForAi } from "../workshop-interests";
import { cheaperFollowUpText, cheaperOptions, cheaperTemplateMessage, type CheaperItem } from "./cant-afford";
import { chatNameInfo } from "./chat-name";
import { affordableOptions, communityLink } from "./community";
import { followUpDue, followUpText, isQuoteLine, QUOTE_FOLLOW_UP_SOURCE, QUOTE_STATE_LABEL, quoteHowText, quoteSituation } from "./quote-follow-up-rules";
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
 *
 * A quien dijo que no le alcanza (dueña, 28-oct: «que el modelo le ofrezca
 * cosas más gratuitas o más económicas, como por ejemplo el taller si hay un
 * taller activo»): en vez de «¿Cuándo te gustaría empezar?», lo más económico
 * que hay ahora (`cant-afford.ts`: el taller abierto, la comunidad, el curso),
 * con los enlaces; fuera de las 24 h, en la plantilla ya aprobada
 * `retomar_conversacion` («Te escribo para retomar nuestra conversación.
 * {{mensaje}}»), porque `seguimiento_proceso` tiene fijo «¿Cuándo te gustaría
 * empezar?». Joselyn y Andrea (23/24-oct) contestaron al 1º «no tengo dinero»:
 * su 2º, 7 días después, ya es este.
 */

const DAY = 24 * 3600_000;
export const QUOTE_TEMPLATE_KEY = "seguimiento_proceso";
/** La plantilla del seguimiento a quien no le alcanza (cuerpo fijo + `{{mensaje}}`). */
export const CHEAPER_TEMPLATE_KEY = "retomar_conversacion";

/** Lo más económico que hay ahora para esta persona (el taller, si no lo pagó ya). */
const cheaperFor = async (contactId: string | null, config: WhatsAppAiConfig, now: Date): Promise<CheaperItem[]> => {
  const open = await openWorkshopForAi(now).catch(() => null);
  const paid = open && contactId ? await enrolledInWorkshop(contactId, open.id).catch(() => false) : false;
  return cheaperOptions({ workshop: open && !paid ? open : null, community: communityLink(config), options: affordableOptions(config) });
};

/**
 * Pistas de un mensaje de Dayana con cómo pagar, para buscar los chats (el
 * detalle lo decide `isQuote` en `quoteSituation`): «pag» cubre el
 * enlace, «pago», «pagas»; también cuentas, Nequi, Daviplata, montos.
 */
const PAYMENT_HINTS = [
  "pag", "comprobante", "western", "nequi", "daviplata", "bancolombia", "cuenta", "usd", "cop", "pesos", "dolares", "dólares", "$",
  // Cualquier otro banco o medio (dueña, 22-oct): los que no dicen «cuenta» ni «pag».
  "banco", "davivienda", "bbva", "colpatria", "scotiabank", "itau", "itaú", "banorte", "banamex", "bancoppel", "hsbc", "bcp", "interbank",
  "produbanco", "banreservas", "banesco", "bancam", "villas", "ahorros", "corriente", "iban", "cbu", "cvu", "zelle", "paypal", "yape", "plin",
  "clabe", "spei", "oxxo", "mpago", "binance", "remitly", "global", "moneygram", "bre-b", "breb", "mxn",
];
/**
 * De la asistente solo cuentan el enlace o los datos de Ajustes que pega el
 * código (`isQuoteLine`): pistas angostas y en su propia consulta, para que sus
 * respuestas (casi todas dicen «pago») no ocupen el cupo de las de Dayana.
 */
const ASSISTANT_HINTS = [
  "/pagar/", "cuenta", "ahorros", "banco", "bancolombia", "davivienda", "titular", "nombre de", "nequi", "daviplata", "western", "clabe",
  "iban", "zelle", "yape", "plin", "paypal", "mpago", "@",
];

type Outcome = "sent" | "not_due" | "blocked" | "not_after_call" | "no_quote" | "no_phone" | "needs_template" | "failed";

type Send = typeof sendWhatsAppToRecipient;

const advance = async (conversationId: string, config: WhatsAppAiConfig, now: Date, send: Send): Promise<Outcome> => {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      ...GUARD_SELECT,
      contact: { select: { firstName: true, timezone: true, countryIso: true, phoneCountryIso: true } },
      dossier: { select: { segment: true, timezone: true } },
    },
  });
  if (!conv) return "no_quote";
  // Un mensaje que nadie pidió: los silencios de siempre, también en un chat
  // con «La IA responde siempre» (eso es para contestarle, no para escribirle
  // sola a un favorito o a una clienta: revisión 22-oct).
  if (await waitingRoomBlocked({ ...conv, aiAlwaysAt: null }, config)) return "blocked";
  if (config.router.enabled && config.router.modes.after_call === "MANUAL") return "blocked";
  if (!/^\d{8,15}$/.test(conv.externalThreadId)) return "no_phone";

  // ¿Le toca? (Barato: un solo query del chat.) El estado se recalcula solo si sí.
  const tz = await quoteZoneFor(conv);
  const lines = await quoteLinesFor(conversationId, config.quoteFollowUp.lookbackDays, now);
  const s = quoteSituation(lines, { now, tz, lookbackDays: config.quoteFollowUp.lookbackDays });
  if (!s) return "no_quote";
  const lastOutboundAt = [...lines].reverse().find((l) => l.direction === "OUTBOUND" && l.kind !== "system")?.sentAt ?? null;
  const due = followUpDue(s, config.quoteFollowUp, { now, tz, lastOutboundAt });
  if (!due) return "not_due";

  // Solo «tuvo la llamada», sin dudas de pago (comprobante por revisar, dice que pagó).
  const seg = await computeSegment(conversationId).catch(() => null);
  if (!seg || seg.stage !== "tuvo_llamada" || seg.review) return "not_after_call";
  // Un comprobante sin revisar: Dayana lo tiene que ver, no se le pide el pago otra vez.
  if (await prisma.whatsAppPaymentReceipt.count({ where: { conversationId, status: "pending" } })) return "blocked";

  // Uno de esta cotización no le llegó: no se insiste. `quoteLinesFor` no ve los
  // fallidos, así que la cuenta seguía en 0 y cada pasada lo mandaba otra vez
  // (Cristina, 26-oct: 15 intentos en 6 h, y Meta pasó a rechazarlos «to maintain
  // healthy ecosystem engagement», lo que daña la calidad del número).
  const failed = await prisma.conversationMessage.findFirst({
    where: { conversationId, direction: "OUTBOUND", status: "FAILED", source: { startsWith: `${QUOTE_FOLLOW_UP_SOURCE}${s.quoteAt.getTime()}:` } },
    select: { id: true },
  });
  if (failed) return "blocked";

  const name = sureFirstName(await chatNameInfo(conversationId));
  const n = s.sent + 1;
  const source = `${QUOTE_FOLLOW_UP_SOURCE}${s.quoteAt.getTime()}:${n}`;
  // Dijo que no le alcanza después del último seguimiento (o de la cotización): lo más
  // económico. Si ya se lo ofreció el 1º y no contestó, el 2º es el de siempre.
  const cheaper = s.state === "sin_dinero" && (!s.lastSentAt || s.saidAt > s.lastSentAt) ? await cheaperFor(conv.contactId, config, now) : [];
  const text = cheaper.length ? cheaperFollowUpText(name, cheaper) : followUpText(due.kind, s.state, name);
  const templateKey = cheaper.length ? CHEAPER_TEMPLATE_KEY : QUOTE_TEMPLATE_KEY;
  const vars: Record<string, string> = cheaper.length
    ? { nombre: name ?? "", mensaje: sanitizeMensaje(cheaperTemplateMessage(cheaper)) }
    : { nombre: name ?? "" };
  // WhatsApp no lo entregó y Dayana lo borró o lo reenvió (Cristina, 26-oct: «User's
  // number is part of an experiment»): ya no está en el chat, así que la cuenta volvía
  // a 0 y salía otra vez. La bitácora lo recuerda: por `source` y, en los de antes de
  // guardarlo, por el texto (el libre o el de la plantilla, con el nombre como sale).
  const template = await approvedTemplateFor(templateKey).catch(() => null);
  const bodies = [text, ...(template?.body ? [fillVars(template.body, { ...vars, nombre: name?.trim() || "😊" })] : [])];
  const triedBefore = await prisma.auditLog.findFirst({
    where: {
      action: { in: ["WHATSAPP_FAILED_DELETED", "WHATSAPP_FAILED_RESENT"] },
      entityType: "WhatsAppChat",
      entityId: conversationId,
      createdAt: { gte: s.quoteAt },
      OR: [{ changes: { path: ["source"], equals: source } }, ...bodies.map((b) => ({ changes: { path: ["body"], equals: b } }))],
    },
    select: { id: true },
  });
  if (triedBefore) return "blocked";
  const r = await send({
    recipient: (conv.contactId ? await recipientFromContact(conv.contactId) : null) ?? {
      contactId: conv.contactId,
      phoneE164: `+${conv.externalThreadId}`,
      name: name ?? conv.participantName,
      optedOut: false,
    },
    text,
    templateKey,
    vars,
    // `recordatorio:`: sale solo, no cuenta como que Dayana contestó.
    source,
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
    body: `${QUOTE_STATE_LABEL[s.state]} · ${quoteHowText(s.how)}. ${
      cheaper.length
        ? `Le ofrecí lo más económico: ${cheaper.map((i) => (i.kind === "workshop" ? `el taller «${i.title}»` : i.kind === "community" ? "la comunidad" : `el ${i.name}`)).join(" y ")}.`
        : "Le escribí para iniciar su proceso."
    }`,
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
    await ensureTemplatesSubmitted([QUOTE_TEMPLATE_KEY, CHEAPER_TEMPLATE_KEY]).catch(() => undefined);
  }
  const since = new Date(now.getTime() - config.quoteFollowUp.lookbackDays * DAY);
  // Los mensajes con alguna pista (los más nuevos primero) y, de esos, los que
  // de verdad son una cotización (de Dayana, o los datos que mandó la
  // asistente): así solo se abren los chats cotizados (unos pocos), no cada
  // chat donde se escribió «pagina» (transferencia de Neon).
  const find = (byAssistant: boolean, words: string[], take: number) =>
    prisma.conversationMessage.findMany({
      where: {
        direction: "OUTBOUND",
        kind: "message",
        sentAt: { gte: since },
        ...(byAssistant ? { OR: [{ isAutoReply: true }, { source: "approval" }] } : { isAutoReply: false }),
        AND: [{ OR: words.map((h) => ({ body: { contains: h, mode: "insensitive" as const } })) }],
        conversation: { channel: "WHATSAPP" },
        ...(opts.conversationIds ? { conversationId: { in: opts.conversationIds } } : {}),
      },
      orderBy: { sentAt: "desc" },
      select: { conversationId: true, body: true, source: true, clientKey: true, isAutoReply: true, sentAt: true },
      take,
    });
  const [byDayana, byAssistant] = await Promise.all([find(false, PAYMENT_HINTS, 1500), find(true, ASSISTANT_HINTS, 500)]);
  const rows = [
    ...new Set([...byDayana, ...byAssistant].filter((m) => isQuoteLine({ ...m, direction: "OUTBOUND" })).map((m) => m.conversationId)),
  ].map((conversationId) => ({ conversationId }));
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
