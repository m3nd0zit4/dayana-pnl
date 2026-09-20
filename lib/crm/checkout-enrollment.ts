import {
  CheckoutContactError,
  resolveCheckoutContact,
  type ResolveCheckoutContactInput,
} from "./checkout-contact";
import { resolveSessionCheckoutContact } from "./checkout-session-contact";
import { EnrollmentValidationError } from "./enrollments";

export type CheckoutContactBody = ResolveCheckoutContactInput & {
  contactId?: string;
  /** @deprecated Legacy pending enrollment from old checkout URLs */
  enrollmentId?: string;
};

export type BeginCheckoutContactInput = {
  planId: string;
  contact: CheckoutContactBody;
};

export type BeginCheckoutContactResult = {
  contactId: string;
  contactCreated: boolean;
};

/** Registers or updates the contact only — no enrollment until payment is approved. */
export async function beginCheckoutContact(
  input: BeginCheckoutContactInput
): Promise<BeginCheckoutContactResult> {
  const { contactId, created } = await resolveCheckoutContact(input.contact);
  return { contactId, contactCreated: created };
}

/**
 * Un `contactId` que llega en el cuerpo de la petición no identifica a nadie:
 * cualquiera puede escribir el de otra persona. Pasado a `upsertContactByPhone`,
 * ese id ancla la escritura y sobrescribe el nombre, el correo y el teléfono de
 * esa ficha, y el cobro se cuelga de ella. La identidad sólo sale de fuentes que
 * el servidor comprueba: la sesión iniciada o el token de un enlace de pago.
 */
const withoutClientContactId = (contact: CheckoutContactBody): CheckoutContactBody => {
  const { contactId: _untrusted, ...rest } = contact;
  void _untrusted;
  return rest;
};

/**
 * Contact resolution for the payment-creation routes. With `fromSession`,
 * the signed-in identity wins: a complete session contact is used directly
 * (no fields needed), an incomplete one anchors the posted fields to it,
 * and an expired session falls back to the plain posted-fields path.
 */
export async function resolveCheckoutContactIdForRequest(input: {
  planId: string;
  contact: CheckoutContactBody;
  fromSession?: boolean;
}): Promise<string> {
  if (input.fromSession === true) {
    const resolved = await resolveSessionCheckoutContact();
    if (resolved) {
      if (resolved.status === "complete") {
        return resolved.contactId;
      }
      const begun = await beginCheckoutContact({
        planId: input.planId,
        contact: {
          ...withoutClientContactId(input.contact),
          contactId: resolved.contactId ?? undefined,
        },
      });
      return begun.contactId;
    }
  }

  const begun = await beginCheckoutContact({
    planId: input.planId,
    contact: withoutClientContactId(input.contact),
  });
  return begun.contactId;
}

/**
 * A quien se le cobra, resuelto en un solo sitio para las cuatro rutas que
 * crean un cobro (orden y suscripcion, PayPal y Mercado Pago).
 *
 * El orden importa y es este:
 *
 *  1. **El enlace de pago manda.** Si la peticion trae un token valido de
 *     `/pagar/<token>` para ESTE producto, el cobro se cuelga de la ficha del
 *     enlace. Se resuelve del token y nunca de un `contactId` del navegador:
 *     aceptar ese dato dejaria colgar un pago de la ficha de cualquiera.
 *     Un enlace sin contacto —los hay a proposito— no aporta nada aqui y se
 *     sigue al paso siguiente.
 *  2. Datos escritos o sesion iniciada: `resolveCheckoutContactIdForRequest`.
 *  3. Nada de lo anterior: contacto temporal, que la captura o el webhook
 *     completan con lo que reporte el pagador.
 *
 * Vivia repetido en las cuatro rutas, y por eso la de alta de suscripcion se
 * quedo sin el paso 1 cuando se anadio: una mensualidad comprada desde un
 * enlace nacia huerfana igual que antes.
 */
export async function resolveCheckoutContactIdForPayment(input: {
  planId: string;
  contact: CheckoutContactBody;
  fromSession?: boolean;
  paymentLinkToken?: string;
}): Promise<string> {
  if (input.paymentLinkToken) {
    const { resolvePaymentLinkOwner } = await import("./payment-links");
    const owner = await resolvePaymentLinkOwner(input.paymentLinkToken);
    if (owner?.contactId && owner.productIds.includes(input.planId)) {
      return owner.contactId;
    }
  }

  // Sin `contactId`: el del navegador no cuenta como dato (ver
  // `withoutClientContactId`).
  const hasContactData = Boolean(input.contact.phone || input.contact.email);
  if (hasContactData || input.fromSession === true) {
    return resolveCheckoutContactIdForRequest({
      planId: input.planId,
      contact: input.contact,
      fromSession: input.fromSession,
    });
  }

  const { createPendingCheckoutContact } = await import("./checkout-placeholder");
  return createPendingCheckoutContact(input.planId);
}

export function mapCheckoutBeginError(e: unknown): {
  status: number;
  error: string;
  message: string;
} {
  if (e instanceof CheckoutContactError) {
    return {
      status: 400,
      error: e.code,
      message: e.message,
    };
  }
  if (e instanceof EnrollmentValidationError) {
    return { status: 400, error: e.code, message: e.message };
  }
  return {
    status: 503,
    error: "crm_unavailable",
    message: "No se pudo registrar tu contacto.",
  };
}
