import {
  EnrollmentStatus,
  ProductKind,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../db";
import {
  isPlaceholderContactPhone,
} from "./checkout-placeholder";
import { getProduct, productSessionsTotal } from "./products";
import { ensureTherapyPackage } from "./therapy";

export class EnrollmentValidationError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
  }
}

const countActiveTherapyEnrollments = async (contactId: string) =>
  prisma.enrollment.count({
    where: {
      contactId,
      status: EnrollmentStatus.ACTIVE,
      product: { kind: ProductKind.THERAPY },
    },
  });

export const createEnrollment = async (input: {
  contactId: string;
  productId: string;
  workshopEditionId?: string;
  status?: EnrollmentStatus;
  label?: string;
  parentEnrollmentId?: string;
  isPrimary?: boolean;
}): Promise<Prisma.EnrollmentGetPayload<{ include: { product: true } }>> => {
  const product = await getProduct(input.productId);
  if (!product) {
    throw new EnrollmentValidationError("Product not found", "PRODUCT_NOT_FOUND");
  }

  if (
    product.kind === ProductKind.THERAPY &&
    input.status === EnrollmentStatus.ACTIVE
  ) {
    const active = await countActiveTherapyEnrollments(input.contactId);
    if (active > 0) {
      throw new EnrollmentValidationError(
        "Contact already has an active therapy enrollment",
        "ACTIVE_THERAPY_EXISTS"
      );
    }
  }

  const sessionsTotal = productSessionsTotal(product);
  if (product.kind === ProductKind.THERAPY && !sessionsTotal) {
    throw new EnrollmentValidationError(
      "Therapy product must have sessionsCount",
      "THERAPY_MISSING_SESSIONS"
    );
  }

  // Idempotencia: el mismo producto no puede quedar dos veces "pendiente"
  // para el mismo contacto — un reintento o doble click debe gestionar el
  // servicio existente, no apilar duplicados. Re-comprar sí es válido
  // cuando el anterior ya está ACTIVE/COMPLETED/CANCELLED, y las
  // renovaciones (parentEnrollmentId) no pasan por aquí.
  if (!input.parentEnrollmentId) {
    const pending = await prisma.enrollment.findFirst({
      where: {
        contactId: input.contactId,
        productId: input.productId,
        status: {
          in: [EnrollmentStatus.LEAD, EnrollmentStatus.PENDING_PAYMENT],
        },
      },
      select: { id: true },
    });
    if (pending) {
      throw new EnrollmentValidationError(
        "Contact already has this product pending",
        "DUPLICATE_SERVICE"
      );
    }
  }

  const price = product.prices[0];

  const enrollment = await prisma.enrollment.create({
    data: {
      contactId: input.contactId,
      productId: input.productId,
      workshopEditionId: input.workshopEditionId ?? null,
      status: input.status ?? EnrollmentStatus.LEAD,
      label: input.label ?? product.title,
      parentEnrollmentId: input.parentEnrollmentId ?? null,
      isPrimary: input.isPrimary ?? false,
      sessionsTotal,
      sessionsUsed: 0,
      currency: price?.currency ?? "USD",
      amountMinor: price?.amountMinor ?? null,
      leadAt: new Date(),
      externalRef: null,
    },
    include: { product: true },
  });

  const status = input.status ?? EnrollmentStatus.LEAD;
  if (status === EnrollmentStatus.LEAD) {
    const { emitLeadStale } = await import("../inngest/events");
    void emitLeadStale(enrollment.id);
  }

  if (
    status === EnrollmentStatus.ACTIVE &&
    enrollment.product.kind === ProductKind.THERAPY &&
    enrollment.sessionsTotal
  ) {
    await ensureTherapyPackage(enrollment.id, enrollment.sessionsTotal);
  }

  return enrollment;
};

export const createPendingPaymentEnrollment = async (input: {
  contactId: string;
  productId: string;
}): Promise<
  Prisma.EnrollmentGetPayload<{ include: { product: true; contact: true } }>
> => {
  const product = await getProduct(input.productId);
  if (!product) {
    throw new EnrollmentValidationError("Product not found", "PRODUCT_NOT_FOUND");
  }

  if (!input.contactId?.trim()) {
    throw new EnrollmentValidationError(
      "contactId is required for checkout",
      "MISSING_CONTACT"
    );
  }

  const contactId = input.contactId.trim();

  const price = product.prices[0];
  const sessionsTotal = productSessionsTotal(product);

  return prisma.enrollment.create({
    data: {
      contactId,
      productId: input.productId,
      status: EnrollmentStatus.PENDING_PAYMENT,
      label: product.title,
      sessionsTotal,
      sessionsUsed: 0,
      currency: price?.currency ?? "USD",
      amountMinor: price?.amountMinor ?? null,
      leadAt: new Date(),
    },
    include: { product: true, contact: true },
  });
};

export const getEnrollmentById = async (id: string) =>
  prisma.enrollment.findUnique({
    where: { id },
    include: {
      contact: true,
      product: true,
      workshopEdition: true,
      payments: { orderBy: { createdAt: "desc" } },
      therapyPackage: { include: { sessions: { orderBy: { sessionNumber: "asc" } } } },
    },
  });

export const markEnrollmentPaid = async (enrollmentId: string) => {
  const enrollment = await getEnrollmentById(enrollmentId);
  if (!enrollment) {
    throw new EnrollmentValidationError("Enrollment not found", "NOT_FOUND");
  }

  if (enrollment.product.kind === ProductKind.THERAPY) {
    const active = await countActiveTherapyEnrollments(enrollment.contactId);
    if (
      active > 0 &&
      enrollment.status !== EnrollmentStatus.ACTIVE
    ) {
      const otherActive = await prisma.enrollment.findFirst({
        where: {
          contactId: enrollment.contactId,
          status: EnrollmentStatus.ACTIVE,
          product: { kind: ProductKind.THERAPY },
          id: { not: enrollmentId },
        },
      });
      if (otherActive) {
        throw new EnrollmentValidationError(
          "Another active therapy exists",
          "ACTIVE_THERAPY_EXISTS"
        );
      }
    }
  }

  const now = new Date();
  const updated = await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status: EnrollmentStatus.ACTIVE,
      paidAt: now,
    },
    include: { product: true, contact: true },
  });

  if (updated.product.kind === ProductKind.THERAPY && updated.sessionsTotal) {
    await ensureTherapyPackage(enrollmentId, updated.sessionsTotal);
  }

  return updated;
};

export const attachContactToEnrollment = async (
  enrollmentId: string,
  contactId: string
) => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { contact: true },
  });
  if (!enrollment) return null;

  if (isPlaceholderContactPhone(enrollment.contact.phoneE164)) {
    await prisma.contact.delete({ where: { id: enrollment.contactId } }).catch(() => {});
  }

  return prisma.enrollment.update({
    where: { id: enrollmentId },
    data: { contactId },
    include: { product: true, contact: true },
  });
};

export const updateEnrollmentStatus = async (
  enrollmentId: string,
  status: EnrollmentStatus
) => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { product: true },
  });
  if (!enrollment) {
    throw new EnrollmentValidationError("Enrollment not found", "NOT_FOUND");
  }

  if (
    status === EnrollmentStatus.ACTIVE &&
    enrollment.product.kind === ProductKind.THERAPY
  ) {
    const other = await prisma.enrollment.findFirst({
      where: {
        contactId: enrollment.contactId,
        status: EnrollmentStatus.ACTIVE,
        product: { kind: ProductKind.THERAPY },
        id: { not: enrollmentId },
      },
    });
    if (other) {
      throw new EnrollmentValidationError(
        "Contact already has an active therapy enrollment",
        "ACTIVE_THERAPY_EXISTS"
      );
    }
  }

  const updated = await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      status,
      ...(status === EnrollmentStatus.COMPLETED
        ? { completedAt: new Date() }
        : {}),
    },
    include: { product: true, contact: true, therapyPackage: true },
  });

  if (
    status === EnrollmentStatus.ACTIVE &&
    updated.product.kind === ProductKind.THERAPY &&
    updated.sessionsTotal
  ) {
    await ensureTherapyPackage(enrollmentId, updated.sessionsTotal);
  }

  return updated;
};

/**
 * Hard-deletes an enrollment with no approved payment (a "service" that was
 * only a lead/pending draft). Payments/TherapyPackage/TherapySessions cascade
 * at the DB level — an enrollment that has ever been paid must be cancelled
 * instead, never deleted, so the payment ledger is never silently dropped.
 */
export const deleteEnrollment = async (enrollmentId: string) => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { payments: { where: { status: "APPROVED" }, select: { id: true } } },
  });
  if (!enrollment) {
    throw new EnrollmentValidationError("Enrollment not found", "NOT_FOUND");
  }
  if (enrollment.payments.length > 0) {
    throw new EnrollmentValidationError(
      "Cannot delete an enrollment with an approved payment",
      "HAS_APPROVED_PAYMENT"
    );
  }

  await prisma.enrollment.delete({ where: { id: enrollmentId } });
};
