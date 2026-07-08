import { addMonths } from "date-fns";
import {
  EnrollmentStatus,
  PaymentStatus,
  ProductKind,
  type Enrollment,
  type Product,
} from "@prisma/client";
import { prisma } from "@/lib/db";

/** How much access a single monthly payment buys. */
export const MEMBERSHIP_MONTHS_PER_PAYMENT = 1;

/** Days before expiry when the portal starts nudging the member to renew. */
export const MEMBERSHIP_WARNING_DAYS = 7;

export const getCourseProduct = async (): Promise<Product | null> =>
  prisma.product.findFirst({
    where: { kind: ProductKind.COURSE, isActive: true },
    orderBy: { sortOrder: "asc" },
  });

export type MembershipExtensionResult = {
  extended: boolean;
  paidUntil?: Date;
};

/**
 * Extends the enrollment's paidUntil by one month for an APPROVED course
 * payment. Exactly-once per payment: the membershipAppliedAt claim inside the
 * transaction makes replays (MP webhook + PayPal capture both call
 * recordPayment) no-ops.
 */
export const applyMembershipExtension = async (
  paymentId: string
): Promise<MembershipExtensionResult> =>
  prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { enrollment: { include: { product: true } } },
    });

    if (
      !payment ||
      payment.status !== PaymentStatus.APPROVED ||
      payment.membershipAppliedAt ||
      payment.enrollment.product.kind !== ProductKind.COURSE
    ) {
      return { extended: false };
    }

    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, membershipAppliedAt: null },
      data: { membershipAppliedAt: new Date() },
    });
    if (claimed.count === 0) {
      return { extended: false };
    }

    const now = new Date();
    const current = payment.enrollment.paidUntil;
    const base = current && current > now ? current : now;
    const paidUntil = addMonths(base, MEMBERSHIP_MONTHS_PER_PAYMENT);

    await tx.enrollment.update({
      where: { id: payment.enrollmentId },
      data: { paidUntil },
    });

    return { extended: true, paidUntil };
  });

export type MembershipInfo = {
  enrollment: (Enrollment & { product: Product }) | null;
  paidUntil: Date | null;
  isCurrent: boolean;
  daysLeft: number | null;
};

/** Days of soft-warning access after paidUntil lapses, before a hard block. */
export const MEMBERSHIP_GRACE_DAYS = 2;

export type MembershipLockState =
  | { kind: "none" }
  | { kind: "warning"; daysUntilBlocked: number }
  | { kind: "blocked"; neverPaid: boolean };

/**
 * Someone who was never an active/paying member (no paidUntil ever set —
 * a brand-new signup, or a lead enrollment that never got activated) is
 * blocked immediately. Someone whose membership just lapsed gets a
 * MEMBERSHIP_GRACE_DAYS warning window before the same hard block kicks in.
 */
export const getMembershipLockState = (
  membership: MembershipInfo
): MembershipLockState => {
  if (membership.isCurrent) return { kind: "none" };
  if (!membership.paidUntil) return { kind: "blocked", neverPaid: true };

  const daysSinceExpiry = Math.floor(
    (Date.now() - membership.paidUntil.getTime()) / (24 * 60 * 60 * 1000)
  );
  if (daysSinceExpiry <= MEMBERSHIP_GRACE_DAYS) {
    return {
      kind: "warning",
      daysUntilBlocked: Math.max(0, MEMBERSHIP_GRACE_DAYS - daysSinceExpiry),
    };
  }
  return { kind: "blocked", neverPaid: false };
};

export const getMembershipForContact = async (
  contactId: string
): Promise<MembershipInfo> => {
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      contactId,
      product: { kind: ProductKind.COURSE },
      status: {
        in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED],
      },
    },
    orderBy: [{ paidUntil: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    include: { product: true },
  });

  const paidUntil = enrollment?.paidUntil ?? null;
  const now = Date.now();
  const isCurrent = paidUntil != null && paidUntil.getTime() > now;
  const daysLeft = paidUntil
    ? Math.ceil((paidUntil.getTime() - now) / (24 * 60 * 60 * 1000))
    : null;

  return { enrollment: enrollment ?? null, paidUntil, isCurrent, daysLeft };
};

/** Admin adjustment — set (or clear) the membership expiry directly. */
export const setMembershipPaidUntil = async (
  enrollmentId: string,
  paidUntil: Date | null
) =>
  prisma.enrollment.update({
    where: { id: enrollmentId },
    data: { paidUntil },
  });

/** Approved payments of the membership, newest first (portal history). */
export const getMembershipPayments = async (
  enrollmentId: string,
  take = 12
) =>
  prisma.payment.findMany({
    where: { enrollmentId, status: PaymentStatus.APPROVED },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    take,
    select: {
      id: true,
      provider: true,
      currency: true,
      amountMinor: true,
      paidAt: true,
      createdAt: true,
    },
  });
