import { PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatMoneyMinor } from "@/lib/crm/money";
import { PAYMENT_PROVIDER_LONG_LABEL } from "@/lib/crm/payment-labels";
import {
  OPERATIONAL_TZ,
  getDateKeyInTz,
  getTimeHmInTz,
} from "@/lib/crm/operational-timezone";
import { BRAND } from "@/lib/contact";
import { emailFrom, siteUrl } from "@/lib/notifications/config";
import { ReceiptError, ensureReceiptNumber } from "./number";
import { pdfText, pdfTextOrNull } from "./text";

export type ReceiptData = {
  receiptNumber: string;
  /** Fecha y hora del cobro en la zona operativa. */
  paidAtLabel: string;
  emitter: { name: string; email: string; site: string };
  payer: { name: string; email: string | null; countryIso: string | null };
  concept: string;
  currency: string;
  /** Lo que se le cobró a la clienta. */
  totalLabel: string;
  /**
   * Comisión y neto. Se muestran sólo si el proveedor los reportó: inventar un
   * cero donde no hay dato diría que la pasarela no cobró nada.
   */
  feeLabel: string | null;
  netLabel: string | null;
  method: string;
  providerReference: string;
  /** Sesiones incluidas, cuando el producto las tiene. */
  sessions: number | null;
};

// Si el nombre visible era sólo un emoji, queda vacío al limpiarlo y se cae al
// nombre y apellido: un recibo con el «pagado por» en blanco no sirve.
const payerName = (c: {
  displayName: string | null;
  firstName: string;
  lastName: string | null;
}): string =>
  pdfTextOrNull(c.displayName) ??
  pdfText(`${c.firstName} ${c.lastName ?? ""}`);

/**
 * Reúne todo lo que va impreso en el recibo.
 *
 * Devuelve importes ya formateados: el documento no debe decidir cómo se
 * escribe un peso frente a un dólar — `formatMoneyMinor` es el único sitio que
 * sabe que el COP no lleva centavos, y duplicar esa regla aquí es como se
 * acaba imprimiendo una cifra cien veces mayor.
 */
export const buildReceiptData = async (
  paymentId: string
): Promise<ReceiptData> => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      enrollment: {
        include: {
          contact: {
            select: {
              displayName: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          product: { select: { title: true } },
        },
      },
    },
  });

  if (!payment) throw new ReceiptError("Payment not found", "NOT_FOUND");
  if (payment.status !== PaymentStatus.APPROVED) {
    throw new ReceiptError("Solo los pagos aprobados tienen recibo", "NOT_APPROVED");
  }

  const receiptNumber = await ensureReceiptNumber(paymentId);
  const at = payment.paidAt ?? payment.createdAt;
  const from = emailFrom();
  const contact = payment.enrollment.contact;

  return {
    receiptNumber,
    paidAtLabel: `${getDateKeyInTz(at, OPERATIONAL_TZ)} · ${getTimeHmInTz(
      at,
      OPERATIONAL_TZ
    )} (hora de Colombia)`,
    // El nombre del emisor sale de la marca y no de la variable de entorno del
    // remitente: el recibo es un documento que se guarda, y un valor mal
    // cargado en Vercel sale impreso tal cual — así apareció «Beltr?n».
    emitter: {
      name: pdfText(BRAND.shortName),
      email: pdfText(from.email),
      site: pdfText(siteUrl().replace(/^https?:\/\//, "")),
    },
    payer: {
      name: payerName(contact),
      email: pdfTextOrNull(contact.email ?? payment.payerEmail),
      countryIso: pdfTextOrNull(payment.payerCountryIso),
    },
    concept: pdfText(payment.enrollment.product.title),
    currency: payment.currency,
    totalLabel: formatMoneyMinor(payment.amountMinor, payment.currency),
    feeLabel:
      payment.feeMinor != null
        ? formatMoneyMinor(payment.feeMinor, payment.currency)
        : null,
    netLabel:
      payment.netMinor != null
        ? formatMoneyMinor(payment.netMinor, payment.currency)
        : null,
    method: pdfText(PAYMENT_PROVIDER_LONG_LABEL[payment.provider]),
    providerReference: pdfText(payment.providerPaymentId),
    sessions: payment.enrollment.sessionsTotal ?? null,
  };
};
