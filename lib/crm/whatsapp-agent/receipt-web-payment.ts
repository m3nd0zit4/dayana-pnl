import { prisma } from "@/lib/db";

/**
 * El comprobante que llega por WhatsApp de un pago que ya entró solo por la
 * página (Gina, 25-oct: pagó el taller por PSE con el enlace, Mercado Pago lo
 * aprobó y la inscribió, y después mandó la captura). Ese pago ya está en el
 * CRM: no hay que registrarlo otra vez, y como su chat no tiene número
 * (usuario de WhatsApp sin teléfono), «Confirmar pago» se quedaba en «crea el
 * contacto a mano». Se reconoce por la referencia del comprobante, que es el id
 * del pago en Mercado Pago o PayPal (`Payment.providerPaymentId`).
 *
 * Solo lee la base (lo usa también lo que ve el chat): sin contactos ni
 * conversaciones.
 */

export type WebPayment = {
  paymentId: string;
  provider: string;
  amountMinor: number;
  currency: string;
  paidAt: Date;
  contactId: string;
  /** Nombre de la ficha; null si es la temporal del checkout («Pendiente»). */
  contactName: string | null;
  /** La ficha es la temporal del checkout (sin nombre ni teléfono todavía). */
  placeholder: boolean;
  product: string | null;
  /** «reference»: la referencia del comprobante es el id del pago. «person»: misma persona, poco antes (a confirmar). */
  match: "reference" | "person";
};

/** Cuánto atrás se busca el pago (el comprobante llega minutos u horas después). */
const LOOKBACK_MS = 30 * 24 * 3600_000;

/** Las formas en que la referencia puede estar guardada: tal cual, sin espacios, solo los dígitos. */
export const referenceCandidates = (reference: string | null | undefined): string[] => {
  const raw = (reference ?? "").trim();
  if (!raw) return [];
  const compact = raw.replace(/[\s.-]/g, "");
  const digits = raw.replace(/\D/g, "");
  return [...new Set([raw, compact, compact.toUpperCase(), digits.length >= 6 ? digits : ""])].filter((r) => r.length >= 6);
};

const PAYMENT_SELECT = {
  id: true,
  provider: true,
  amountMinor: true,
  currency: true,
  createdAt: true,
  enrollment: {
    select: {
      contactId: true,
      product: { select: { title: true } },
      contact: { select: { firstName: true, lastName: true, phoneE164: true } },
    },
  },
} as const;

type PaymentRow = {
  id: string;
  provider: string;
  amountMinor: number;
  currency: string;
  createdAt: Date;
  enrollment: {
    contactId: string;
    product: { title: string } | null;
    contact: { firstName: string; lastName: string | null; phoneE164: string };
  };
};

const toWebPayment = (payment: PaymentRow, match: WebPayment["match"]): WebPayment => {
  const c = payment.enrollment.contact;
  const placeholder = c.firstName === "Pendiente" || c.phoneE164.startsWith("+pending");
  return {
    paymentId: payment.id,
    provider: payment.provider,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    paidAt: payment.createdAt,
    contactId: payment.enrollment.contactId,
    contactName: placeholder ? null : [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
    placeholder,
    product: payment.enrollment.product?.title ?? null,
    match,
  };
};

/** Ya enlazado a otro comprobante: no cuenta (un pago, un comprobante). */
const takenByOther = async (paymentId: string, receiptId: string) =>
  (await prisma.whatsAppPaymentReceipt.count({ where: { paymentId, id: { not: receiptId } } })) > 0;

/**
 * Sin referencia que cuadre (Victorino, 25-oct: pagó por PayPal y 5 minutos
 * después mandó la captura, sin valor ni número legibles; Dayana la confirmó
 * y registró «Transferencia 190.000 COP» encima del mismo pago): un pago de la
 * página de la misma persona entre 48 h antes y 2 h después del comprobante.
 * Solo un aviso: Dayana dice si es el mismo pago.
 */
const SAME_PERSON_BEFORE_MS = 48 * 3600_000;
const SAME_PERSON_AFTER_MS = 2 * 3600_000;

/**
 * El pago aprobado de la página que corresponde a este comprobante (y que no es
 * de otro comprobante), o null: por la referencia (`match: "reference"`, seguro)
 * o, si no, por la misma persona poco antes (`match: "person"`, a confirmar).
 */
export const webPaymentForReceipt = async (
  receipt: { id: string; reference: string | null; conversationId?: string; contactId?: string | null; createdAt?: Date },
  now = new Date()
): Promise<WebPayment | null> => {
  const refs = referenceCandidates(receipt.reference);
  if (refs.length) {
    const byRef = await prisma.payment.findFirst({
      where: { status: "APPROVED", providerPaymentId: { in: refs }, createdAt: { gte: new Date(now.getTime() - LOOKBACK_MS) } },
      orderBy: { createdAt: "desc" },
      select: PAYMENT_SELECT,
    });
    if (byRef && !(await takenByOther(byRef.id, receipt.id))) return toWebPayment(byRef, "reference");
  }
  const contactId =
    receipt.contactId ??
    (receipt.conversationId
      ? ((await prisma.conversation.findUnique({ where: { id: receipt.conversationId }, select: { contactId: true } }))?.contactId ?? null)
      : null);
  if (!contactId) return null;
  const at = (receipt.createdAt ?? now).getTime();
  const candidates = await prisma.payment.findMany({
    where: {
      status: "APPROVED",
      provider: { in: ["PAYPAL", "MERCADO_PAGO"] },
      enrollment: { contactId },
      createdAt: { gte: new Date(at - SAME_PERSON_BEFORE_MS), lte: new Date(at + SAME_PERSON_AFTER_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: PAYMENT_SELECT,
  });
  for (const p of candidates) if (!(await takenByOther(p.id, receipt.id))) return toWebPayment(p, "person");
  return null;
};

/** «Mercado Pago», «PayPal»: para la tarjeta del chat. */
export const providerLabel = (provider: string): string =>
  provider === "MERCADO_PAGO" ? "Mercado Pago" : provider === "PAYPAL" ? "PayPal" : provider.toLowerCase();
