import {
  PaymentProvider,
  PaymentStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../db";
import { markEnrollmentPaid } from "./enrollments";

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

  if (input.status === PaymentStatus.APPROVED) {
    await markEnrollmentPaid(input.enrollmentId);

    const { emitPaymentApproved, runPaymentConfirmationNow } = await import(
      "../inngest/events"
    );
    await emitPaymentApproved(input.enrollmentId);

    const { isNotificationsEnabled } = await import("../notifications/config");
    const inngestConfigured = Boolean(process.env.INNGEST_EVENT_KEY?.trim());
    if (isNotificationsEnabled() && !inngestConfigured) {
      void runPaymentConfirmationNow(input.enrollmentId).catch((e) =>
        console.warn("[notifications] payment confirmation failed", e)
      );
    }
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

export const resolveEnrollmentFromReference = async (
  externalReference: string
): Promise<string | null> => {
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
