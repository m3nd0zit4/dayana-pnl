import { prisma } from "../db";
import { getSiteUrl } from "../site-url";
import { leadEventId, sendCapiEvent } from "./capi";

/**
 * Envía el `Lead` de un diagnóstico a la Conversions API.
 *
 * Gemelo de `sendPurchaseToMetaCapi`, y por los mismos motivos: corre como
 * step de Inngest —fuera del camino de la petición, con reintentos— y se
 * apoya en un sello en base de datos para no contar dos veces.
 *
 * Por qué importa aquí más que en el Purchase: el Lead es el evento con el que
 * Meta optimiza las campañas. Si sólo llega por el navegador, cada bloqueador
 * de anuncios se lleva por delante una conversión que sí ocurrió, y el
 * algoritmo aprende de un embudo que parece peor de lo que es.
 */

export type CapiLeadOutcome =
  | { status: "sent"; diagnosticId: string; eventId: string }
  | {
      status: "skipped";
      reason:
        | "not_found"
        | "not_completed"
        | "no_contact"
        | "already_sent"
        | "no_ad_tracking_consent"
        | "not_configured"
        | "no_match_keys";
    };

export const sendLeadToMetaCapi = async (
  diagnosticId: string
): Promise<CapiLeadOutcome> => {
  const diagnostic = await prisma.diagnostic.findUnique({
    where: { id: diagnosticId },
    select: {
      id: true,
      token: true,
      completedAt: true,
      capiSentAt: true,
      profile: true,
      contact: true,
      product: { select: { id: true, title: true } },
    },
  });

  if (!diagnostic) return { status: "skipped", reason: "not_found" };
  if (!diagnostic.completedAt) {
    return { status: "skipped", reason: "not_completed" };
  }
  if (!diagnostic.contact) return { status: "skipped", reason: "no_contact" };
  if (diagnostic.capiSentAt) {
    return { status: "skipped", reason: "already_sent" };
  }

  // El consentimiento manda, igual que en el Purchase: CAPI recupera señal que
  // el navegador bloquea por motivos técnicos, no consentimiento negado.
  if (!diagnostic.contact.consentAdTrackingAt) {
    return { status: "skipped", reason: "no_ad_tracking_consent" };
  }

  const eventId = leadEventId(diagnostic.id);

  const result = await sendCapiEvent({
    eventName: "Lead",
    eventId,
    eventTime: diagnostic.completedAt,
    // La URL donde ocurre para la persona es la del resultado, no la del
    // cuestionario: es la página que el Pixel tiene delante cuando dispara su
    // mitad del evento.
    eventSourceUrl: `${getSiteUrl()}/terapias/resultado/${diagnostic.token}`,
    userData: {
      email: diagnostic.contact.email,
      phoneE164: diagnostic.contact.phoneE164,
      firstName: diagnostic.contact.firstName,
      lastName: diagnostic.contact.lastName,
      countryIso: diagnostic.contact.countryIso,
    },
    customData: {
      content_name: "diagnostico",
      content_category: diagnostic.profile ?? undefined,
      // Lo que se le recomendó. Meta no lo necesita para atribuir, pero sí
      // permite comparar en su panel qué recomendación trae compras.
      ...(diagnostic.product
        ? {
            content_ids: [diagnostic.product.id],
            content_type: "product",
          }
        : {}),
    },
  });

  if (!result.sent) return { status: "skipped", reason: result.reason };

  await prisma.diagnostic.update({
    where: { id: diagnostic.id },
    data: { capiSentAt: new Date() },
  });

  return { status: "sent", diagnosticId: diagnostic.id, eventId };
};
