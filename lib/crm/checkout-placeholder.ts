import { EnrollmentStatus, PaymentStatus } from "@prisma/client";
import {
  emitPlatformNotification,
  fireNotification,
} from "@/lib/notifications/platform/emit";
import { prisma } from "../db";
import { normalizePhone } from "../phone";
import type { CountryCode } from "libphonenumber-js";

/** Temporary checkout contacts — never shown in CRM lists. */
export const PLACEHOLDER_PHONE_PREFIX = "+pending";

export const isPlaceholderContactPhone = (phone: string): boolean =>
  phone.startsWith(PLACEHOLDER_PHONE_PREFIX);

/**
 * Contacto temporal para el checkout sin formulario previo (Lemon Squeezy).
 *
 * LS es merchant of record y recoge email, nombre y dirección de facturación
 * por obligación fiscal, así que pedirlos otra vez antes de pagar sólo resta
 * conversión. Se crea un contacto con teléfono `+pending:<uuid>` para que la
 * referencia del checkout (`chk:<contactId>:<planId>`) siga funcionando igual
 * que con PayPal y Mercado Pago, y el webhook lo completa con los datos reales.
 *
 * Los contactos con este prefijo quedan fuera de listas del CRM, estadísticas
 * y del hash de Meta CAPI, y `abandonCheckoutEnrollment` los barre si nunca
 * llegan a pagar.
 */
export const createPendingCheckoutContact = async (
  planId: string
): Promise<string> => {
  const contact = await prisma.contact.create({
    data: {
      phoneE164: `${PLACEHOLDER_PHONE_PREFIX}:${crypto.randomUUID()}`,
      firstName: "Pendiente",
      sourceDetail: `checkout:${planId}`,
    },
    select: { id: true },
  });
  return contact.id;
};

/**
 * Completa un contacto temporal con lo que el proveedor de pago reportó.
 *
 * Si ya existe un contacto REAL con ese email, gana ese y el temporal se
 * borra: de lo contrario `Contact.email` es `@unique` y el update reventaría,
 * o peor, quedarían dos fichas para la misma persona. Devuelve el id que debe
 * usarse para matricular.
 */
/**
 * Reconstruye un contacto cuando el de la referencia ya no está.
 *
 * Prefiere la ficha existente con ese email; si no hay ninguna, crea una nueva
 * con teléfono temporal — el mismo que `/pago/exito` pide después y que
 * `PAYMENT_CONTACT_INCOMPLETE` marca para perseguir.
 */
const resurrectContactFromPayer = async (data: {
  email?: string;
  firstName?: string;
  lastName?: string;
  countryIso?: string;
}): Promise<string> => {
  const email = data.email?.trim().toLowerCase() || undefined;

  if (email) {
    const existing = await prisma.contact.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  const contact = await prisma.contact.create({
    data: {
      phoneE164: `${PLACEHOLDER_PHONE_PREFIX}:${crypto.randomUUID()}`,
      firstName: data.firstName?.trim() || "Pendiente",
      ...(data.lastName?.trim() ? { lastName: data.lastName.trim() } : {}),
      ...(email ? { email } : {}),
      ...(data.countryIso
        ? { countryIso: data.countryIso.trim().toUpperCase().slice(0, 2) }
        : {}),
      sourceDetail: "pago recuperado sin contacto",
    },
    select: { id: true },
  });
  return contact.id;
};

export const reconcilePendingCheckoutContact = async (
  pendingContactId: string,
  data: {
    email?: string;
    firstName?: string;
    lastName?: string;
    /** Teléfono crudo del proveedor; se normaliza aquí. */
    phone?: string;
    /** ISO-3166-1 alpha-2 del pagador; sirve de país por defecto al teléfono. */
    countryIso?: string;
  }
): Promise<string> => {
  const pending = await prisma.contact.findUnique({
    where: { id: pendingContactId },
    select: { id: true, phoneE164: true },
  });

  /**
   * El contacto de la referencia ya no existe.
   *
   * Pasa de verdad: el temporal lo puede haber barrido la limpieza nocturna, o
   * haberse borrado al resolver una colisión de email en un intento anterior.
   * La referencia es un puntero a una fila que puede desaparecer, y el webhook
   * llega después — a veces días después, si el pago fue en efectivo.
   *
   * Antes se devolvía el id muerto y `createEnrollment` reventaba con una
   * violación de clave foránea: pago cobrado, nada en el CRM. Costó un cobro
   * real de 599.68 USD. Un pago capturado hay que registrarlo sí o sí, así que
   * se reconstruye el contacto con lo que reporta el pagador.
   */
  if (!pending) {
    return resurrectContactFromPayer(data);
  }

  if (!isPlaceholderContactPhone(pending.phoneE164)) return pending.id;

  const email = data.email?.trim().toLowerCase() || undefined;
  const countryIso = data.countryIso?.trim().toUpperCase().slice(0, 2) || undefined;

  /**
   * El teléfono llega crudo y en formatos distintos según el proveedor, así
   * que se normaliza a E.164 antes de tocar la base. Si no se puede validar
   * se descarta en silencio: el placeholder `+pending:` es preferible a un
   * número roto, y `/pago/exito` lo sigue pidiendo.
   */
  const normalized = data.phone
    ? normalizePhone(data.phone, (countryIso as CountryCode) ?? "CO")
    : null;

  /**
   * Colisiones. `Contact.email` y `Contact.phoneE164` son AMBOS `@unique`.
   * Si el pagador ya tiene ficha real por cualquiera de los dos, gana esa y el
   * temporal se borra; escribir sin comprobarlo reventaría la compra entera
   * con un fallo de unicidad justo después de cobrar.
   */
  const existing = await prisma.contact.findFirst({
    where: {
      id: { not: pending.id },
      OR: [
        ...(email ? [{ email }] : []),
        ...(normalized ? [{ phoneE164: normalized.phoneE164 }] : []),
      ],
    },
    select: { id: true },
  });

  if ((email || normalized) && existing) {
    await prisma.contact.delete({ where: { id: pending.id } }).catch(() => {
      // Sin matrícula todavía no debería fallar; si falla, el temporal se
      // queda huérfano y lo barre la limpieza nocturna.
    });
    return existing.id;
  }

  await prisma.contact.update({
    where: { id: pending.id },
    data: {
      ...(email ? { email } : {}),
      ...(data.firstName?.trim() ? { firstName: data.firstName.trim() } : {}),
      ...(data.lastName?.trim() ? { lastName: data.lastName.trim() } : {}),
      ...(normalized
        ? {
            phoneE164: normalized.phoneE164,
            phoneCountryIso: normalized.phoneCountryIso,
          }
        : {}),
      ...(countryIso ? { countryIso } : {}),
    },
  });
  return pending.id;
};

/**
 * ¿Sigue este contacto sin teléfono utilizable?
 *
 * Es la señal de "falta el dato de contacto principal": el número es por donde
 * Dayana coordina las sesiones, y ningún proveedor lo garantiza.
 */
export const hasPlaceholderPhone = async (
  contactId: string
): Promise<boolean> => {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { phoneE164: true },
  });
  return contact ? isPlaceholderContactPhone(contact.phoneE164) : false;
};


/**
 * Removes abandoned checkout: placeholder contact + PENDING_PAYMENT enrollment.
 * Safe no-op when payment already approved or contact is real.
 */
export const abandonCheckoutEnrollment = async (
  enrollmentId: string,
  // The stale sweep passes `false` so a nightly purge of 100 checkouts emits
  // one summary notification instead of 100 individual ones.
  options: { notify?: boolean } = {}
): Promise<{ abandoned: boolean; reason?: string }> => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      contact: { select: { id: true, phoneE164: true, email: true } },
      /**
       * Cualquier pago que NO esté rechazado bloquea el borrado, no sólo el
       * aprobado. Un PSE queda PENDING minutos y uno en efectivo días: con el
       * filtro anterior la barrida de 24 h borraba la matrícula, y con ella
       * —en cascada— la fila PENDING y hasta el contacto. Cuando Mercado Pago
       * mandaba después el `approved`, la referencia apuntaba a un contacto
       * inexistente: dinero cobrado y ni rastro en el CRM.
       */
      payments: { where: { status: { not: PaymentStatus.FAILED } }, take: 1 },
    },
  });

  if (!enrollment) {
    return { abandoned: false, reason: "not_found" };
  }

  if (!isPlaceholderContactPhone(enrollment.contact.phoneE164)) {
    return { abandoned: false, reason: "real_contact" };
  }

  if (enrollment.payments.length > 0) {
    return { abandoned: false, reason: "payment_in_flight" };
  }

  /**
   * Intento de pago rechazado de alguien identificable.
   *
   * El teléfono sigue siendo `+pending:` —lo pide `/pago/exito`, y a ese paso
   * no llegó— pero el proveedor sí reportó su email, así que no es un checkout
   * abandonado sino una clienta que INTENTÓ pagar y no pudo. Borrarlo era
   * tirar exactamente el caso que hay que revisar y devolver la llamada.
   */
  const rejected = await prisma.payment.count({
    where: { enrollmentId, status: PaymentStatus.FAILED },
  });
  if (rejected > 0 && enrollment.contact.email) {
    return { abandoned: false, reason: "failed_attempt_with_contact" };
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

  if (options.notify !== false) {
    fireNotification({
      eventType: "CHECKOUT_ABANDONED",
      title: `Checkout abandonado: ${enrollment.label ?? "servicio sin nombre"}`,
      body: "El cliente llegó al pago y no lo completó. Se borró el registro temporal.",
      entityType: "Enrollment",
      entityId: enrollmentId,
      staff: "ALL",
    });
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
      // Mismo criterio que `abandonCheckoutEnrollment`: un pago pendiente es
      // un pago en curso, no un checkout abandonado.
      payments: { none: { status: { not: PaymentStatus.FAILED } } },
    },
    select: { id: true },
    take: 100,
  });

  let abandoned = 0;
  for (const row of stale) {
    const result = await abandonCheckoutEnrollment(row.id, { notify: false });
    if (result.abandoned) abandoned += 1;
  }

  if (abandoned > 0) {
    // Runs from the daily cron, outside any request scope, so awaiting the
    // emit is what guarantees it lands. It can never break the sweep.
    await emitPlatformNotification({
      eventType: "CHECKOUT_ABANDONED",
      title:
        abandoned === 1
          ? "Se limpió 1 checkout abandonado"
          : `Se limpiaron ${abandoned} checkouts abandonados`,
      body: `Checkouts sin pago con más de ${STALE_CHECKOUT_HOURS} horas.`,
      metadata: { count: abandoned },
      staff: "ALL",
    }).catch(() => undefined);
  }

  return abandoned;
};
