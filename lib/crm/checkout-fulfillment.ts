import { EnrollmentStatus, PaymentStatus, ProductKind } from "@prisma/client";
import { prisma } from "../db";
import { createEnrollment, markEnrollmentPaid } from "./enrollments";
import { recordPayment, type RecordPaymentInput } from "./payments";
import { markPaymentLinkPaid } from "./payment-links";
import { linkEnrollmentToWorkshopEdition } from "./workshop-pricing";
import { redeemPromoCode } from "./promo-codes";

export type FulfillCheckoutPaymentInput = Omit<
  RecordPaymentInput,
  "enrollmentId"
> & {
  contactId: string;
  productId: string;
  /** Discount already baked into `amountMinor` — recorded here for bookkeeping only. */
  promoCodeRedemption?: { code: string; discountMinor: number };
};

const redeemIfPresent = async (
  enrollmentId: string,
  currency: string,
  promo?: { code: string; discountMinor: number }
): Promise<void> => {
  if (!promo) return;
  try {
    const row = await prisma.promoCode.findUnique({
      where: { code: promo.code.trim().toUpperCase() },
      select: { id: true },
    });
    if (!row) return;
    await redeemPromoCode({
      promoCodeId: row.id,
      enrollmentId,
      currency,
      discountMinor: promo.discountMinor,
    });
  } catch (e) {
    // Bookkeeping only — never let redemption tracking break a real payment.
    console.error("[checkout-fulfillment] promo redemption failed", e);
  }
};

/**
 * Un cobro ya APROBADO cuya matrícula no quedó activa.
 *
 * Si la fila del pago se escribió pero `markEnrollmentPaid` falló después, el
 * webhook suelta su marca y el proveedor reintenta — y ese reintento veía el
 * pago ya aprobado y salía sin volver a activar. El dinero quedaba cobrado y
 * el acceso sin conceder. Sólo se activa si NO está activa: activar dos veces
 * una membresía podría sumar un mes de más.
 */
const ensureEnrollmentActivated = async (enrollmentId: string) => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { status: true },
  });
  if (!enrollment || enrollment.status === EnrollmentStatus.ACTIVE) return;
  try {
    await markEnrollmentPaid(enrollmentId);
  } catch (e) {
    console.error(
      "[checkout-fulfillment] approved payment could not activate its enrollment",
      enrollmentId,
      e instanceof Error ? e.message : String(e)
    );
  }
};

/**
 * Creates an ACTIVE enrollment and records payment when web checkout completes.
 * Idempotent per provider payment id.
 */
export const fulfillCheckoutPayment = async (
  input: FulfillCheckoutPaymentInput
): Promise<string> => {
  const existing = await prisma.payment.findUnique({
    where: {
      provider_providerPaymentId: {
        provider: input.provider,
        providerPaymentId: input.providerPaymentId,
      },
    },
    select: { enrollmentId: true, status: true },
  });

  /**
   * Ya existe fila para este cobro. Si estaba PENDING —el PSE o el efectivo
   * que Mercado Pago avisa dos veces— NO se puede salir por aquí: hay que
   * dejar que `recordPayment` la suba a APPROVED y active la matrícula. Salir
   * antes dejaba el pago congelado en pendiente con el dinero ya cobrado.
   *
   * Con la fila ya en estado final, sí es un reenvío y se devuelve tal cual.
   */
  if (existing && existing.status !== PaymentStatus.PENDING) {
    if (existing.status === PaymentStatus.APPROVED) {
      await ensureEnrollmentActivated(existing.enrollmentId);
    }
    return existing.enrollmentId;
  }
  if (existing) {
    const { contactId: _pc, productId: _pp, promoCodeRedemption: promo, ...rest } =
      input;
    await recordPayment({ ...rest, enrollmentId: existing.enrollmentId });
    await redeemIfPresent(existing.enrollmentId, input.currency, promo);
    await markPaymentLinkPaid({
      contactId: input.contactId,
      productId: input.productId,
      enrollmentId: existing.enrollmentId,
    });
    return existing.enrollmentId;
  }

  const { contactId: _c, productId: _p, promoCodeRedemption, ...paymentInput } = input;

  // Course = monthly membership: renewals land on the contact's existing
  // enrollment instead of piling up duplicate ACTIVE enrollments.
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { kind: true },
  });
  if (product?.kind === ProductKind.COURSE) {
    const existingEnrollmentId = await findEnrollmentForCheckout(
      input.contactId,
      input.productId
    );
    if (existingEnrollmentId) {
      await recordPayment({
        ...paymentInput,
        enrollmentId: existingEnrollmentId,
      });
      await redeemIfPresent(existingEnrollmentId, input.currency, promoCodeRedemption);
      await markPaymentLinkPaid({
        contactId: input.contactId,
        productId: input.productId,
        enrollmentId: existingEnrollmentId,
      });
      return existingEnrollmentId;
    }
  }

  const enrollment = await createEnrollment({
    contactId: input.contactId,
    productId: input.productId,
    status: EnrollmentStatus.ACTIVE,
    // El dinero ya está capturado: registrar es obligatorio, no opcional. Las
    // reglas de "una terapia activa por contacto" y "sin duplicados
    // pendientes" son higiene del panel y no pueden rechazar un cobro hecho.
    paidPurchase: true,
  });

  try {
    const payment = await recordPayment({
      ...paymentInput,
      enrollmentId: enrollment.id,
    });
    if (payment.enrollmentId !== enrollment.id) {
      // Carrera perdida: la captura y el webhook llegaron a la vez y el otro
      // camino registró este cobro primero, con su matrícula. La nuestra no
      // tiene pagos y sólo quedaría como una matrícula activa huérfana.
      await prisma.enrollment
        .delete({ where: { id: enrollment.id } })
        .catch((e) =>
          console.error(
            "[checkout-fulfillment] orphan enrollment not removed",
            e instanceof Error ? e.message : String(e)
          )
        );
      return payment.enrollmentId;
    }
    await redeemIfPresent(enrollment.id, input.currency, promoCodeRedemption);
  } catch (e) {
    const raced = await prisma.payment.findUnique({
      where: {
        provider_providerPaymentId: {
          provider: input.provider,
          providerPaymentId: input.providerPaymentId,
        },
      },
      select: { enrollmentId: true },
    });
    if (raced) return raced.enrollmentId;
    throw e;
  }

  await markPaymentLinkPaid({
    contactId: input.contactId,
    productId: input.productId,
    enrollmentId: enrollment.id,
  });

  // El pago de un taller queda ligado a SU edición (la del producto
  // `taller-<slug>`), no a «la que esté abierta» cuando alguien la mire.
  if (product?.kind === ProductKind.WORKSHOP) {
    await linkEnrollmentToWorkshopEdition(enrollment.id, input.productId);
  }

  return enrollment.id;
};

export const findEnrollmentForCheckout = async (
  contactId: string,
  productId: string
): Promise<string | null> => {
  const row = await prisma.enrollment.findFirst({
    where: {
      contactId,
      productId,
      status: {
        in: [
          EnrollmentStatus.ACTIVE,
          EnrollmentStatus.COMPLETED,
          EnrollmentStatus.PENDING_PAYMENT,
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return row?.id ?? null;
};
