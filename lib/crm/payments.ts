import {
  EnrollmentStatus,
  PaymentProvider,
  PaymentStatus,
  type Prisma,
} from "@prisma/client";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { prisma } from "../db";
import { abandonCheckoutEnrollment } from "./checkout-placeholder";
import { parseCheckoutReference } from "./checkout-reference";
import { markEnrollmentPaid } from "./enrollments";
import { formatMoneyMinor } from "./money";

const PROVIDER_LABEL: Record<PaymentProvider, string> = {
  PAYPAL: "PayPal",
  MERCADO_PAGO: "Mercado Pago",
  MANUAL: "Registro manual",
  STRIPE: "Stripe",
  LEMON_SQUEEZY: "Lemon Squeezy",
};

const contactName = (contact: {
  displayName: string | null;
  firstName: string;
}): string => contact.displayName ?? contact.firstName;

export type RecordPaymentInput = {
  enrollmentId: string;
  provider: PaymentProvider;
  providerPaymentId: string;
  providerOrderId?: string;
  status: PaymentStatus;
  currency: string;
  amountMinor: number;
  feeMinor?: number;
  netMinor?: number;
  payerEmail?: string;
  payerCountryIso?: string;
  rawPayload?: unknown;
  paidAt?: Date;
};

export const recordPayment = async (
  input: RecordPaymentInput
): Promise<Prisma.PaymentGetPayload<object>> => {
  const payment = await prisma.payment.upsert({
    where: {
      provider_providerPaymentId: {
        provider: input.provider,
        providerPaymentId: input.providerPaymentId,
      },
    },
    create: {
      enrollmentId: input.enrollmentId,
      provider: input.provider,
      providerPaymentId: input.providerPaymentId,
      providerOrderId: input.providerOrderId ?? null,
      status: input.status,
      currency: input.currency.slice(0, 3).toUpperCase(),
      amountMinor: input.amountMinor,
      feeMinor: input.feeMinor ?? null,
      netMinor: input.netMinor ?? null,
      payerEmail: input.payerEmail ?? null,
      payerCountryIso: input.payerCountryIso?.slice(0, 2).toUpperCase() ?? null,
      rawPayload: input.rawPayload
        ? (input.rawPayload as Prisma.InputJsonValue)
        : undefined,
      paidAt: input.paidAt ?? (input.status === PaymentStatus.APPROVED ? new Date() : null),
    },
    update: {
      status: input.status,
      paidAt:
        input.status === PaymentStatus.APPROVED
          ? input.paidAt ?? new Date()
          : undefined,
      rawPayload: input.rawPayload
        ? (input.rawPayload as Prisma.InputJsonValue)
        : undefined,
    },
  });

  const amountLabel = `${payment.currency} ${formatMoneyMinor(
    payment.amountMinor,
    payment.currency
  )}`;

  if (input.status === PaymentStatus.APPROVED) {
    const enrollment = await markEnrollmentPaid(input.enrollmentId);
    const who = contactName(enrollment.contact);

    fireNotification({
      eventType: "PAYMENT_APPROVED",
      title: `Pago aprobado: ${who} — ${amountLabel}`,
      body: `${enrollment.product.title} · ${PROVIDER_LABEL[input.provider]}`,
      entityType: "Payment",
      entityId: payment.id,
      metadata: {
        enrollmentId: input.enrollmentId,
        provider: input.provider,
      },
      staff: "ALL",
      contactIds: [enrollment.contactId],
    });

    if (input.provider === PaymentProvider.MANUAL) {
      fireNotification({
        eventType: "MANUAL_PAYMENT_RECORDED",
        title: `Pago manual registrado: ${who} — ${amountLabel}`,
        body: enrollment.product.title,
        href: `/admin/enrollments/${input.enrollmentId}`,
        entityType: "Payment",
        entityId: payment.id,
        staff: "ALL",
      });
    }

    // Course memberships: each approved payment buys one month of access.
    // Must never break the webhook path; the Inngest payment-approved fn
    // retries any extension this swallows.
    const { applyMembershipExtension } = await import("../lms/membership");
    await applyMembershipExtension(payment.id).catch(() => undefined);

    const { emitPaymentApproved } = await import("../inngest/events");
    await emitPaymentApproved(input.enrollmentId);
  } else if (input.status === PaymentStatus.FAILED) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: input.enrollmentId },
      select: {
        status: true,
        label: true,
        contact: { select: { displayName: true, firstName: true } },
      },
    });

    const who = enrollment ? contactName(enrollment.contact) : null;
    fireNotification({
      eventType: "PAYMENT_FAILED",
      title: who
        ? `Pago rechazado: ${who} — ${amountLabel}`
        : `Pago rechazado — ${amountLabel}`,
      body: `${PROVIDER_LABEL[input.provider]}${
        enrollment?.label ? ` · ${enrollment.label}` : ""
      }`,
      href: `/admin/enrollments/${input.enrollmentId}`,
      entityType: "Payment",
      entityId: payment.id,
      staff: "ALL",
    });

    if (enrollment?.status === EnrollmentStatus.PENDING_PAYMENT) {
      await abandonCheckoutEnrollment(input.enrollmentId);
    }
  } else if (input.status === PaymentStatus.REFUNDED) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: input.enrollmentId },
      select: {
        contactId: true,
        label: true,
        contact: { select: { displayName: true, firstName: true } },
      },
    });

    fireNotification({
      eventType: "PAYMENT_REFUNDED",
      title: enrollment
        ? `Pago reembolsado: ${contactName(enrollment.contact)} — ${amountLabel}`
        : `Pago reembolsado — ${amountLabel}`,
      body: `${PROVIDER_LABEL[input.provider]}${
        enrollment?.label ? ` · ${enrollment.label}` : ""
      }`,
      entityType: "Payment",
      entityId: payment.id,
      staff: "ALL",
      contactIds: enrollment ? [enrollment.contactId] : undefined,
    });
  }

  return payment;
};

export const registerWebhookEvent = async (
  provider: PaymentProvider,
  eventId: string,
  payload?: unknown
): Promise<boolean> => {
  try {
    await prisma.webhookEvent.create({
      data: {
        provider,
        eventId,
        payload: payload ? (payload as Prisma.InputJsonValue) : undefined,
      },
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * Releases the idempotency claim taken by `registerWebhookEvent` so the
 * provider's retry actually re-runs the handler. Only call this when the
 * handler failed: fulfilment is idempotent per provider payment id, so a
 * re-run is safe, whereas keeping the claim would turn a transient DB blip
 * into a payment that is never recorded.
 */
export const releaseWebhookEvent = async (
  provider: PaymentProvider,
  eventId: string
): Promise<void> => {
  await prisma.webhookEvent
    .deleteMany({ where: { provider, eventId } })
    .catch(() => undefined);
};

export const resolveEnrollmentFromReference = async (
  externalReference: string
): Promise<string | null> => {
  if (parseCheckoutReference(externalReference)) {
    return null;
  }

  const byId = await prisma.enrollment.findUnique({
    where: { id: externalReference },
    select: { id: true },
  });
  if (byId) return byId.id;

  const legacy = await prisma.enrollment.findFirst({
    where: { productId: externalReference, status: "PENDING_PAYMENT" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return legacy?.id ?? null;
};
