import { addMonths } from "date-fns";
import {
  EnrollmentStatus,
  PaymentStatus,
  ProductKind,
  type Enrollment,
  type Product,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { OPERATIONAL_TZ } from "@/lib/crm/operational-timezone";
import { fireNotification } from "@/lib/notifications/platform/emit";

/** How much access a single monthly payment buys. */
export const MEMBERSHIP_MONTHS_PER_PAYMENT = 1;

/** Days before expiry when the portal starts nudging the member to renew. */
export const MEMBERSHIP_WARNING_DAYS = 7;

/**
 * El producto que realmente se cobra: la mensualidad. Es el único COURSE que
 * NO es contenido de la biblioteca, así que un pago suyo abre todos los cursos
 * (ver `getEnrolledCourses`).
 */
export const getMembershipProduct = async (): Promise<Product | null> =>
  prisma.product.findFirst({
    where: {
      kind: ProductKind.COURSE,
      isActive: true,
      isCourseContent: false,
    },
    orderBy: { sortOrder: "asc" },
  });

/**
 * Los cursos de la biblioteca. Antes de sembrar el currículo no existe ninguno
 * y los módulos cuelgan directamente del producto de la mensualidad — por eso
 * el respaldo: sin cursos de contenido, la mensualidad **es** el curso.
 */
export const listCourseProducts = async (): Promise<Product[]> => {
  const courses = await prisma.product.findMany({
    where: {
      kind: ProductKind.COURSE,
      isActive: true,
      isCourseContent: true,
    },
    orderBy: { sortOrder: "asc" },
  });
  if (courses.length > 0) return courses;

  const membership = await getMembershipProduct();
  return membership ? [membership] : [];
};

export const getCourseProduct = async (): Promise<Product | null> =>
  (await listCourseProducts())[0] ?? null;

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
): Promise<MembershipExtensionResult> => {
  const outcome = await prisma.$transaction(async (tx) => {
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
      return { extended: false as const };
    }

    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, membershipAppliedAt: null },
      data: { membershipAppliedAt: new Date() },
    });
    if (claimed.count === 0) {
      return { extended: false as const };
    }

    const now = new Date();
    const current = payment.enrollment.paidUntil;
    const base = current && current > now ? current : now;
    const paidUntil = addMonths(base, MEMBERSHIP_MONTHS_PER_PAYMENT);

    await tx.enrollment.update({
      where: { id: payment.enrollmentId },
      data: { paidUntil },
    });

    return {
      extended: true as const,
      paidUntil,
      enrollmentId: payment.enrollmentId,
      contactId: payment.enrollment.contactId,
      productTitle: payment.enrollment.product.title,
    };
  });

  if (!outcome.extended) return { extended: false };

  fireNotification({
    eventType: "MEMBERSHIP_EXTENDED",
    title: `Tu acceso a ${outcome.productTitle} sigue activo`,
    body: `Con este pago quedas al día hasta el ${new Intl.DateTimeFormat(
      "es-CO",
      { timeZone: OPERATIONAL_TZ, dateStyle: "long" }
    ).format(outcome.paidUntil)}.`,
    href: "/miembros/cuenta/facturacion",
    entityType: "Enrollment",
    entityId: outcome.enrollmentId,
    contactIds: [outcome.contactId],
  });

  return { extended: true, paidUntil: outcome.paidUntil };
};

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

/** Synthetic membership for the owner-portal bridge — always current, no real Enrollment/Payment. */
const OWNER_MEMBERSHIP: MembershipInfo = {
  enrollment: null,
  paidUntil: null,
  isCurrent: true,
  daysLeft: null,
};

export const getMembershipForContact = async (
  contactId: string,
  opts: { isOwner?: boolean } = {}
): Promise<MembershipInfo> => {
  if (opts.isOwner) return OWNER_MEMBERSHIP;

  // La mensualidad manda; una inscripción a un curso suelto solo se usa si no
  // hay membresía.
  const enrollment =
    (await prisma.enrollment.findFirst({
      where: {
        contactId,
        product: { kind: ProductKind.COURSE, isCourseContent: false },
        status: {
          in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED],
        },
      },
      orderBy: [
        { paidUntil: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      include: { product: true },
    })) ??
    (await prisma.enrollment.findFirst({
      where: {
        contactId,
        product: { kind: ProductKind.COURSE },
        status: {
          in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED],
        },
      },
      orderBy: [
        { paidUntil: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      include: { product: true },
    }));

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

export type EnrolledCourse = {
  product: Product;
  membership: MembershipInfo;
};

const membershipInfoFrom = (
  enrollment: Enrollment & { product: Product }
): MembershipInfo => {
  const paidUntil = enrollment.paidUntil;
  const now = Date.now();
  return {
    enrollment,
    paidUntil,
    isCurrent: paidUntil != null && paidUntil.getTime() > now,
    daysLeft: paidUntil
      ? Math.ceil((paidUntil.getTime() - now) / (24 * 60 * 60 * 1000))
      : null,
  };
};

/**
 * Los cursos a los que el contacto tiene acceso — la fuente del dashboard y el
 * gate de quiz, material y playback.
 *
 * El acceso es **all-access**: una mensualidad vigente (inscripción al producto
 * que no es contenido) abre todos los cursos de la biblioteca. Las
 * inscripciones directas a un curso concreto se respetan encima, por si alguna
 * vez se vende un curso suelto o quedó una inscripción histórica.
 */
export const getEnrolledCourses = async (
  contactId: string,
  opts: { isOwner?: boolean } = {}
): Promise<EnrolledCourse[]> => {
  if (opts.isOwner) {
    const products = await listCourseProducts();
    return products.map((product) => ({ product, membership: OWNER_MEMBERSHIP }));
  }

  const enrollments = await prisma.enrollment.findMany({
    where: {
      contactId,
      product: { kind: ProductKind.COURSE },
      status: { in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED] },
    },
    orderBy: [{ paidUntil: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    include: { product: true },
  });
  if (enrollments.length === 0) return [];

  // Solo la más reciente por producto (las renovaciones crean filas nuevas).
  const byProduct = new Map<string, Enrollment & { product: Product }>();
  for (const en of enrollments) {
    if (!byProduct.has(en.productId)) byProduct.set(en.productId, en);
  }

  const membershipEnrollment = [...byProduct.values()].find(
    (en) => !en.product.isCourseContent
  );

  const result = new Map<string, EnrolledCourse>();

  if (membershipEnrollment) {
    const membership = membershipInfoFrom(membershipEnrollment);
    for (const product of await listCourseProducts()) {
      result.set(product.id, { product, membership });
    }
  }

  for (const enrollment of byProduct.values()) {
    if (!enrollment.product.isCourseContent) continue;
    result.set(enrollment.productId, {
      product: enrollment.product,
      membership: membershipInfoFrom(enrollment),
    });
  }

  return [...result.values()];
};

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
