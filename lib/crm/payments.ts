import {
  EnrollmentStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from "@prisma/client";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { prisma } from "../db";
import {
  abandonCheckoutEnrollment,
  hasPlaceholderPhone,
} from "./checkout-placeholder";
import { parseCheckoutReference } from "./checkout-reference";
import { markEnrollmentPaid } from "./enrollments";
import { formatMoneyMinor } from "./money";
import { PAYMENT_PROVIDER_LONG_LABEL as PROVIDER_LABEL } from "./payment-labels";
import { linkEnrollmentToWorkshopEdition } from "./workshop-pricing";

const contactName = (contact: {
  displayName: string | null;
  firstName: string;
}): string => contact.displayName ?? contact.firstName;

/**
 * Qué se cobró, para los avisos al equipo. Un cobro de monto libre cuelga del
 * producto oculto «Pago personalizado», que no dice nada: lo que lo describe es
 * el concepto que Dayana escribió, guardado como etiqueta de la matrícula. Para
 * el resto de productos sigue siendo el título del producto, como siempre.
 */
const paidItemTitle = (enrollment: {
  label: string | null;
  product: { kind: string; title: string };
}): string =>
  enrollment.product.kind === "OTHER" && enrollment.label
    ? enrollment.label
    : enrollment.product.title;

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
  /**
   * Por qué falló, cuando falló. `failureCode` es el crudo del proveedor
   * (`INSTRUMENT_DECLINED`, `cc_rejected_insufficient_amount`) y
   * `failureMessage` el motivo ya traducido para el equipo. Sin esto un rechazo
   * no dejaba rastro: había que llamar al proveedor para saber qué pasó.
   */
  failureCode?: string;
  failureMessage?: string;
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
      failureCode: input.failureCode ?? null,
      failureMessage: input.failureMessage ?? null,
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
      // Un pago que acaba aprobado deja de tener motivo de fallo. Un PSE
      // rechazado que se reintenta y entra no puede quedarse con el motivo
      // viejo colgando: diría que falló algo que sí se cobró.
      failureCode:
        input.status === PaymentStatus.APPROVED ? null : input.failureCode,
      failureMessage:
        input.status === PaymentStatus.APPROVED ? null : input.failureMessage,
      rawPayload: input.rawPayload
        ? (input.rawPayload as Prisma.InputJsonValue)
        : undefined,
    },
  });

  /**
   * La fila ya existía y cuelga de OTRA matrícula.
   *
   * Pasa cuando la captura en el navegador y el webhook del proveedor llegan a
   * la vez: los dos ven que el cobro no existe, los dos crean su matrícula, y
   * el segundo `upsert` actualiza la fila del primero en vez de fallar. Seguir
   * adelante activaría la matrícula huérfana del segundo y duplicaría el aviso
   * de pago aprobado. El primero ya hizo todo eso por la matrícula buena; aquí
   * se devuelve la fila tal cual y quien llamó decide qué hacer con la suya.
   */
  if (payment.enrollmentId !== input.enrollmentId) {
    return payment;
  }

  const amountLabel = `${payment.currency} ${formatMoneyMinor(
    payment.amountMinor,
    payment.currency
  )}`;

  if (input.status === PaymentStatus.APPROVED) {
    const enrollment = await markEnrollmentPaid(input.enrollmentId);
    const who = contactName(enrollment.contact);

    // Pagar un taller es quedar inscrita en SU edición, venga el pago de donde
    // venga. Antes sólo lo hacía el checkout de la página: un pago manual
    // (transferencia, Nequi) activaba la matrícula pero sin edición, y la
    // persona no salía entre las inscritas ni recibía los recordatorios (Ever,
    // 1-nov: Nequi 190.000 COP del taller registrado y «no inscrito»).
    await linkEnrollmentToWorkshopEdition(input.enrollmentId, enrollment.productId);

    fireNotification({
      eventType: "PAYMENT_APPROVED",
      title: `Pago aprobado: ${who} — ${amountLabel}`,
      body: `${paidItemTitle(enrollment)} · ${PROVIDER_LABEL[input.provider]}`,
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
        body: paidItemTitle(enrollment),
        href: `/admin/enrollments/${input.enrollmentId}`,
        entityType: "Payment",
        entityId: payment.id,
        staff: "ALL",
      });
    }

    /**
     * El teléfono es por donde Dayana coordina las sesiones, y ningún
     * proveedor lo garantiza: PayPal sólo lo manda si la preferencia de la
     * cuenta está activa, Mercado Pago a veces no lo trae, y el formulario de
     * `/pago/exito` es voluntario — quien cierra la pestaña no lo deja.
     *
     * Se avisa en lugar de poner un formulario antes de pagar: eso es justo lo
     * que se quitó para subir conversión, y en Mercado Pago recorta señales al
     * antifraude. Aquí sólo se marca "hay que pedírselo".
     */
    if (await hasPlaceholderPhone(enrollment.contactId)) {
      fireNotification({
        eventType: "PAYMENT_CONTACT_INCOMPLETE",
        title: `Falta el teléfono de ${who}`,
        body: `Pagó ${paidItemTitle(enrollment)} (${amountLabel}) y no dejó número. Escríbele para coordinar.`,
        href: `/admin/contacts/${enrollment.contactId}`,
        entityType: "Contact",
        entityId: enrollment.contactId,
        metadata: {
          enrollmentId: input.enrollmentId,
          provider: input.provider,
        },
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
      /**
       * El motivo va delante de todo. Antes el aviso sólo decía «Pago
       * rechazado — 599.68 USD» por PayPal, así que enterarse no servía de
       * nada: había que llamar al proveedor para saber si fue el banco, el CVV
       * o falta de saldo. Con el motivo, Dayana puede escribirle a esa clienta
       * sabiendo qué decirle.
       */
      body: [
        input.failureMessage,
        `${PROVIDER_LABEL[input.provider]}${
          enrollment?.label ? ` · ${enrollment.label}` : ""
        }`,
      ]
        .filter(Boolean)
        .join(" — "),
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

/**
 * El pago aprobado con el que esta persona ya tiene ese taller, o null.
 *
 * Un taller se paga una vez. Victorino (26-oct) lo pagó por PayPal con el
 * enlace y, al confirmar su captura por WhatsApp, quedó además una
 * «Transferencia 190.000 COP» manual sobre la misma inscripción: el mismo
 * dinero contado dos veces. Antes de registrar un pago manual de un taller se
 * mira si ya hay uno aprobado de la misma persona, en esa matrícula u otra del
 * mismo producto o de la misma edición. Solo talleres: terapias y cursos sí se
 * pagan por partes o cada mes.
 */
export const paidWorkshopPaymentFor = async (
  enrollmentId: string
): Promise<{ id: string; provider: PaymentProvider; amountMinor: number; currency: string; paidAt: Date | null } | null> => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { contactId: true, productId: true, workshopEditionId: true, product: { select: { kind: true } } },
  });
  if (!enrollment || enrollment.product.kind !== "WORKSHOP") return null;
  // Un producto compartido heredado (`workshop-virtual`) cobró varias ediciones:
  // haberlo pagado antes no dice nada de ésta. Solo el producto propio de UNA edición.
  const editions = await prisma.workshopEdition.findMany({
    where: { productId: enrollment.productId },
    select: { id: true },
    take: 2,
  });
  const ownProduct = editions.length === 1;
  const edition = enrollment.workshopEditionId ?? (ownProduct ? editions[0].id : null);
  if (!edition) return null;
  return prisma.payment.findFirst({
    where: {
      status: PaymentStatus.APPROVED,
      enrollment: {
        contactId: enrollment.contactId,
        OR: [{ workshopEditionId: edition }, ...(ownProduct ? [{ productId: enrollment.productId }] : [])],
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, provider: true, amountMinor: true, currency: true, paidAt: true },
  });
};

/**
 * Reclama la marca de idempotencia de un aviso. `false` significa —y sólo
 * significa— **«este aviso ya se procesó»**.
 *
 * Antes capturaba cualquier excepción y devolvía `false` para todas. Un fallo
 * transitorio de la base era indistinguible de un duplicado real, y los dos
 * llamantes tratan el `false` como «ya está hecho» y responden 200: el
 * proveedor daba la entrega por buena y no reintentaba. Un cobro cobrado que
 * nunca se registra, sin que nadie se entere.
 *
 * Ahora sólo el conflicto de clave única (`P2002`, que es literalmente «ya
 * existe esta fila») cuenta como duplicado. Cualquier otro error se propaga,
 * el webhook responde 5xx y el proveedor reintenta — que es exactamente lo
 * que hay que hacer cuando no sabemos si lo procesamos.
 */
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
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return false;
    }
    throw e;
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
