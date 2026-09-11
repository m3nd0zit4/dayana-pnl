import {
  CheckoutContactError,
  resolveCheckoutContact,
  type ResolveCheckoutContactInput,
} from "./checkout-contact";
import { resolveSessionCheckoutContact } from "./checkout-session-contact";
import { EnrollmentValidationError } from "./enrollments";
import { prisma } from "../db";

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
          ...input.contact,
          contactId: resolved.contactId ?? undefined,
        },
      });
      return begun.contactId;
    }
  }

  const begun = await beginCheckoutContact({
    planId: input.planId,
    contact: input.contact,
  });
  return begun.contactId;
}

/**
 * La ficha a la que se cuelga un cobro, sabiendo si viene de un enlace de pago.
 *
 * Es `resolveCheckoutContactIdForRequest` más el token del enlace, y el token
 * **manda sobre todo lo demás**. Sin esto, una compra hecha desde
 * `/pagar/<token>` caía en la rama anónima y fabricaba un contacto `+pending:`
 * nuevo: Dayana mandaba el enlace a una clienta conocida y la matrícula
 * aterrizaba en un duplicado, reconciliado más tarde sólo si el correo del
 * pagador coincidía por casualidad.
 *
 * Viaja el TOKEN y no el `contactId` porque es lo único seguro: si el navegador
 * mandara un `contactId`, cualquiera podría colgar su pago de la ficha de otra
 * persona. El token es un secreto de 128 bits y aquí se comprueban además su
 * caducidad y su revocación.
 *
 * Un token que no resuelve no es un error: el enlace puede haber caducado
 * mientras la compradora tenía la pestaña abierta, y negarle el cobro sería
 * perder una venta que ya estaba acordada. Se sigue por el camino normal.
 */
export async function resolveCheckoutContactIdForPayment(input: {
  planId: string;
  contact: CheckoutContactBody;
  fromSession?: boolean;
  paymentLinkToken?: string;
}): Promise<string> {
  if (input.paymentLinkToken) {
    const link = await prisma.paymentLink.findUnique({
      where: { token: input.paymentLinkToken },
      select: { contactId: true, revokedAt: true, expiresAt: true },
    });
    const usable =
      link != null &&
      link.revokedAt == null &&
      (link.expiresAt == null || link.expiresAt > new Date());
    if (usable && link.contactId) return link.contactId;
  }

  return resolveCheckoutContactIdForRequest({
    planId: input.planId,
    contact: input.contact,
    fromSession: input.fromSession,
  });
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
