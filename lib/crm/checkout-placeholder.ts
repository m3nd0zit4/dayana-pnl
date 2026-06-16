import { EnrollmentStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "../db";

/** Temporary checkout contacts — never shown in CRM lists. */
export const PLACEHOLDER_PHONE_PREFIX = "+pending";

export const isPlaceholderContactPhone = (phone: string): boolean =>
  phone.startsWith(PLACEHOLDER_PHONE_PREFIX);

/**
 * Removes abandoned checkout: placeholder contact + PENDING_PAYMENT enrollment.
 * Safe no-op when payment already approved or contact is real.
 */
export const abandonCheckoutEnrollment = async (
  enrollmentId: string
): Promise<{ abandoned: boolean; reason?: string }> => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      contact: { select: { id: true, phoneE164: true } },
      payments: { where: { status: PaymentStatus.APPROVED }, take: 1 },
    },
  });

  if (!enrollment) {
    return { abandoned: false, reason: "not_found" };
  }

  if (!isPlaceholderContactPhone(enrollment.contact.phoneE164)) {
    return { abandoned: false, reason: "real_contact" };
  }

  if (enrollment.payments.length > 0) {
    return { abandoned: false, reason: "payment_approved" };
  }

  if (
    enrollment.status === EnrollmentStatus.ACTIVE ||
    enrollment.status === EnrollmentStatus.COMPLETED
  ) {
    return { abandoned: false, reason: "already_active" };
  }

  const contactId = enrollment.contactId;
  await prisma.enrollment.delete({ where: { id: enrollmentId } });

  const remainingEnrollments = await prisma.enrollment.count({
    where: { contactId },
  });
  if (remainingEnrollments === 0) {
    await prisma.contact.delete({ where: { id: contactId } }).catch(() => {});
  }

  return { abandoned: true };
};

/** Stale placeholder checkouts older than this are purged by cron. */
export const STALE_CHECKOUT_HOURS = 24;

export const abandonStalePlaceholderCheckouts = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - STALE_CHECKOUT_HOURS * 60 * 60 * 1000);

  const stale = await prisma.enrollment.findMany({
    where: {
      status: EnrollmentStatus.PENDING_PAYMENT,
      createdAt: { lt: cutoff },
      contact: { phoneE164: { startsWith: PLACEHOLDER_PHONE_PREFIX } },
      payments: { none: { status: PaymentStatus.APPROVED } },
    },
    select: { id: true },
    take: 100,
  });

  let abandoned = 0;
  for (const row of stale) {
    const result = await abandonCheckoutEnrollment(row.id);
    if (result.abandoned) abandoned += 1;
  }
  return abandoned;
};
