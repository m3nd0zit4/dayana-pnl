import { renderQuickMessage } from "@/lib/crm/render-message";
import { prisma } from "@/lib/db";
import type { OutboundChannel } from "./config";
import { dispatchAndRecord } from "./dispatch";
import {
  paymentConfirmationHtml,
  paymentConfirmationSubject,
  paymentConfirmationText,
} from "./templates/payment-confirmation";
import { paymentVars } from "./variables";
import {
  buildReceiptData,
  receiptFilename,
  renderReceiptPdf,
} from "@/lib/payments/receipt";
import type { EmailAttachment } from "./channels/email";

const defaultChannels: OutboundChannel[] = ["EMAIL", "SMS", "WHATSAPP_API"];

export const sendPaymentConfirmation = async (enrollmentId: string) => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      contact: true,
      product: true,
      payments: {
        where: { status: "APPROVED" },
        orderBy: { paidAt: "desc" },
        take: 1,
      },
    },
  });

  if (!enrollment?.payments[0]) {
    return { skipped: true, reason: "no_approved_payment" };
  }

  const payment = enrollment.payments[0];
  const contact = enrollment.contact;

  if (!contact.email && payment.payerEmail) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { email: payment.payerEmail.trim().toLowerCase() },
    });
    contact.email = payment.payerEmail.trim().toLowerCase();
  }

  const vars = paymentVars(contact, enrollment, payment);
  const template = await prisma.messageTemplate.findUnique({
    where: { key_locale: { key: "post_payment_therapy", locale: "es" } },
  });

  const body =
    template?.body ??
    "Hola {{first_name}}, recibimos tu pago de {{payment_amount}} por {{product_title}}.";

  const smsBody = renderQuickMessage(body, vars);

  /**
   * El recibo, adjunto al correo.
   *
   * Va en un try/catch a propósito y sin reintento: la confirmación del pago
   * es lo que la clienta está esperando, y no puede dejar de salir porque el
   * PDF falle. Si no se genera, el correo se manda igual y el recibo sigue
   * estando a un clic en el panel y en `/cuenta/facturacion`.
   */
  let attachments: EmailAttachment[] | undefined;
  try {
    const receipt = await buildReceiptData(payment.id);
    const pdf = await renderReceiptPdf(receipt);
    attachments = [
      {
        filename: receiptFilename(receipt.receiptNumber),
        content: pdf.toString("base64"),
        contentType: "application/pdf",
      },
    ];
  } catch (e) {
    console.error("[payment-confirmation] no se pudo generar el recibo", {
      paymentId: payment.id,
      error: (e as Error).message,
    });
  }

  const results = [];

  for (const channel of defaultChannels) {
    const payload = {
      contactId: contact.id,
      channel,
      templateKey: "payment_confirmation" as const,
      body: smsBody,
      vars,
      subject: paymentConfirmationSubject(vars),
      html: paymentConfirmationHtml(vars),
      text: paymentConfirmationText(vars),
      // Sólo el correo lleva el PDF; `dispatchToChannel` lo ignora en SMS y
      // WhatsApp.
      attachments: channel === "EMAIL" ? attachments : undefined,
    };

    if (channel === "EMAIL" && !contact.email && !payment.payerEmail) {
      results.push({ channel, status: "SKIPPED" });
      continue;
    }

    const { result } = await dispatchAndRecord(payload);
    results.push({ channel, status: result.status });
  }

  return { contactId: contact.id, results };
};
