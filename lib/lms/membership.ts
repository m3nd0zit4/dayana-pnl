import { addMonths } from "date-fns";
import {
  EnrollmentStatus,
  PaymentStatus,
  ProductKind,
  type Enrollment,
  type Prisma,
  type Product,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { OPERATIONAL_TZ } from "@/lib/crm/operational-timezone";
import { fireNotification } from "@/lib/notifications/platform/emit";

/** Meses que concede un pago cuando el producto no dice otra cosa. */
export const MEMBERSHIP_MONTHS_PER_PAYMENT = 1;

/**
 * El producto que se cobra de forma **recurrente**: la mensualidad.
 *
 * Existe como constante exportada porque la comparten esta librería y los dos
 * scripts que crean los planes en PayPal y Mercado Pago, y ahí la precisión es
 * crítica: esos scripts hacían `findFirst` sin orden sobre "cualquier COURSE
 * vendible". Con la anualidad conviviendo, esa consulta podía devolver el
 * producto anual y repuntar el Billing Plan de PayPal a su importe — es decir,
 * cobrarle el precio de un año a quien se suscribió por meses.
 *
 * La anualidad es un pago único que concede doce meses (`membershipMonths`),
 * nunca un plan recurrente, así que queda fuera por definición.
 */
export const MONTHLY_MEMBERSHIP_WHERE: Prisma.ProductWhereInput = {
  kind: ProductKind.COURSE,
  isActive: true,
  isCourseContent: false,
  OR: [{ membershipMonths: null }, { membershipMonths: { lte: 1 } }],
};

/** Days before expiry when the portal starts nudging the member to renew. */
export const MEMBERSHIP_WARNING_DAYS = 7;

/**
 * El producto que realmente se cobra: la mensualidad. Es el único COURSE que
 * NO es contenido de la biblioteca, así que un pago suyo abre todos los cursos
 * (ver `getEnrolledCourses`).
 */
export const getMembershipProduct = async (): Promise<Product | null> =>
  prisma.product.findFirst({
    where: MONTHLY_MEMBERSHIP_WHERE,
    orderBy: { sortOrder: "asc" },
  });

/**
 * Los productos que abren la biblioteca: la mensualidad y la anualidad.
 *
 * Los dos son `COURSE` no-contenido, así que ambos cuentan como membresía para
 * `getMembershipForContact` y `getEnrolledCourses` sin cambiar nada: lo que
 * decide el acceso es `paidUntil`, no cuál de los dos se pagó.
 */
export const listMembershipProducts = async (): Promise<Product[]> =>
  prisma.product.findMany({
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
  /** El pago abrió un curso suelto: acceso sin caducidad, no hay `paidUntil`. */
  lifetime?: boolean;
};

/**
 * Abre el acceso que compró un pago APROBADO de un producto COURSE.
 *
 * Hay dos formas de comprar curso y este es el punto donde se separan:
 *
 * - **Mensualidad** (`isCourseContent: false`) — suma un mes a `paidUntil`.
 *   Es all-access: abre toda la biblioteca mientras esté vigente.
 * - **Curso suelto** (`isCourseContent: true`) — marca `lifetimeAccess` y deja
 *   `paidUntil` intacto. Sumarle un mes, que es lo que hacía esta función
 *   antes de existir la venta suelta, convertía una compra a perpetuidad en
 *   30 días de acceso: se cobra una vez y se cierra la puerta al mes.
 *
 * Exactly-once por pago en las dos ramas: el claim de `membershipAppliedAt`
 * dentro de la transacción hace que los reintentos (el webhook de MP y la
 * captura de PayPal llaman los dos a `recordPayment`) sean no-ops.
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

    const shared = {
      extended: true as const,
      enrollmentId: payment.enrollmentId,
      contactId: payment.enrollment.contactId,
      productTitle: payment.enrollment.product.title,
    };

    // Curso suelto: se compra entero, no por meses.
    if (payment.enrollment.product.isCourseContent) {
      await tx.enrollment.update({
        where: { id: payment.enrollmentId },
        data: { lifetimeAccess: true },
      });
      return { ...shared, lifetime: true as const, paidUntil: undefined };
    }

    const now = new Date();
    const current = payment.enrollment.paidUntil;
    const base = current && current > now ? current : now;
    // Cuántos meses concede este pago lo dice el producto, no una constante:
    // es lo único que distingue la mensualidad de la anualidad, y ambas llegan
    // aquí por el mismo camino (`recordPayment` → pago aprobado de un COURSE).
    const months =
      payment.enrollment.product.membershipMonths ??
      MEMBERSHIP_MONTHS_PER_PAYMENT;
    const paidUntil = addMonths(base, months);

    await tx.enrollment.update({
      where: { id: payment.enrollmentId },
      data: { paidUntil },
    });

    return { ...shared, lifetime: false as const, paidUntil };
  });

  if (!outcome.extended) return { extended: false };

  fireNotification(
    outcome.lifetime
      ? {
          eventType: "COURSE_ACCESS_GRANTED",
          title: `Ya tienes ${outcome.productTitle}`,
          body: "Tu acceso a este curso no caduca: entra cuando quieras.",
          href: "/cursos",
          entityType: "Enrollment",
          entityId: outcome.enrollmentId,
          contactIds: [outcome.contactId],
        }
      : {
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
        }
  );

  return {
    extended: true,
    paidUntil: outcome.paidUntil,
    lifetime: outcome.lifetime,
  };
};

export type MembershipInfo = {
  enrollment: (Enrollment & { product: Product }) | null;
  paidUntil: Date | null;
  /** Compra suelta: el acceso no caduca y `paidUntil` no significa nada. */
  lifetime: boolean;
  isCurrent: boolean;
  daysLeft: number | null;
};

/**
 * La única forma de derivar acceso a partir de una matrícula.
 *
 * Existía duplicada en `getMembershipForContact` y en `getEnrolledCourses`, y
 * con dos maneras de tener acceso —mes pagado y compra a perpetuidad— dos
 * copias es cómo una de ellas se queda atrás y deja fuera a quien ya pagó.
 */
const membershipInfoOf = (
  enrollment: (Enrollment & { product: Product }) | null
): MembershipInfo => {
  const paidUntil = enrollment?.paidUntil ?? null;
  const lifetime = enrollment?.lifetimeAccess ?? false;
  const now = Date.now();
  return {
    enrollment,
    paidUntil,
    lifetime,
    isCurrent: lifetime || (paidUntil != null && paidUntil.getTime() > now),
    // Un acceso que no caduca no tiene días restantes que contar; devolver un
    // número aquí haría que el portal avisara de una renovación inexistente.
    daysLeft:
      paidUntil && !lifetime
        ? Math.ceil((paidUntil.getTime() - now) / (24 * 60 * 60 * 1000))
        : null,
  };
};

/** ¿Esta persona nunca llegó a pagar este curso? Ni mes, ni compra suelta. */
export const isNeverPaid = (membership: MembershipInfo): boolean =>
  membership.paidUntil == null && !membership.lifetime;

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
  lifetime: false,
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

  return membershipInfoOf(enrollment ?? null);
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

const membershipInfoFrom = membershipInfoOf;

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
