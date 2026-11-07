import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireStaff } from "@/agent/lib/guard";
import { prisma } from "@/lib/db";
import { formatMoneyMinor } from "@/lib/crm/money";
import { paymentProviderLabel } from "@/lib/crm/payment-labels";

const money = (minor: number | null, currency: string) =>
  minor == null ? null : `${formatMoneyMinor(minor, currency)} ${currency}`;

export default defineTool({
  description:
    "Get one payment by id (from list_payments): amount, fee and net in its currency (minor units plus formatted), provider and its reference, status, failure reason, receipt number, the enrollment/product/workshop it pays and the person, and any WhatsApp receipt (comprobante) linked to it. The provider's raw payload is not included.",
  inputSchema: z.object({ paymentId: z.string().min(1) }),
  async execute({ paymentId }, ctx) {
    requireStaff(ctx);
    const p = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        provider: true,
        providerPaymentId: true,
        providerOrderId: true,
        status: true,
        currency: true,
        amountMinor: true,
        feeMinor: true,
        netMinor: true,
        payerEmail: true,
        payerCountryIso: true,
        failureCode: true,
        failureMessage: true,
        receiptNumber: true,
        paidAt: true,
        createdAt: true,
        enrollment: {
          select: {
            id: true,
            status: true,
            amountMinor: true,
            currency: true,
            workshopEditionId: true,
            product: { select: { id: true, title: true } },
            contact: {
              select: { id: true, firstName: true, lastName: true, displayName: true, email: true, phoneE164: true },
            },
          },
        },
      },
    });
    if (!p) return { found: false as const };

    const [receipts, edition] = await Promise.all([
      prisma.whatsAppPaymentReceipt.findMany({
        where: { paymentId: p.id },
        select: { id: true, status: true, method: true, reference: true, conversationId: true, createdAt: true },
      }),
      p.enrollment.workshopEditionId
        ? prisma.workshopEdition.findUnique({
            where: { id: p.enrollment.workshopEditionId },
            select: { slug: true, title: true },
          })
        : null,
    ]);
    const c = p.enrollment.contact;

    return {
      found: true as const,
      payment: {
        id: p.id,
        status: p.status,
        provider: paymentProviderLabel(p.provider),
        providerPaymentId: p.providerPaymentId,
        providerOrderId: p.providerOrderId,
        currency: p.currency,
        amountMinor: p.amountMinor,
        amount: money(p.amountMinor, p.currency),
        fee: money(p.feeMinor, p.currency),
        net: money(p.netMinor, p.currency),
        payerEmail: p.payerEmail,
        payerCountryIso: p.payerCountryIso,
        failure: p.failureMessage ?? p.failureCode,
        failureCode: p.failureCode,
        receiptNumber: p.receiptNumber,
        paidAt: p.paidAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      },
      enrollment: {
        id: p.enrollment.id,
        status: p.enrollment.status,
        product: p.enrollment.product.title,
        productId: p.enrollment.product.id,
        price: p.enrollment.currency ? money(p.enrollment.amountMinor, p.enrollment.currency) : null,
        workshop: edition ? { slug: edition.slug, title: edition.title } : null,
        ref: { type: "enrollment" as const, id: p.enrollment.id, href: `/admin/enrollments/${p.enrollment.id}` },
      },
      contact: {
        id: c.id,
        name: c.displayName ?? `${c.firstName} ${c.lastName ?? ""}`.trim(),
        email: c.email,
        phone: c.phoneE164.startsWith("+pending:") || c.phoneE164.startsWith("+nophone") ? null : c.phoneE164,
        ref: { type: "contact" as const, id: c.id, href: `/admin/contacts/${c.id}` },
      },
      whatsappReceipts: receipts.map((r) => ({
        id: r.id,
        status: r.status,
        method: r.method,
        reference: r.reference,
        createdAt: r.createdAt.toISOString(),
        ref: {
          type: "conversation" as const,
          id: r.conversationId,
          href: `/admin/whatsapp?conversation=${r.conversationId}`,
        },
      })),
    };
  },
});
