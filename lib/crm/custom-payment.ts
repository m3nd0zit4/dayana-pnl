import { ProductKind } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { Plan } from "@/lib/plans";

import {
  CUSTOM_PAYMENT_PRODUCT_ID,
  customPlanFromTerms,
  customTermsFromLink,
  parseCustomPlanId,
  type ResolvedCustomTerms,
} from "./custom-payment-rules";

/**
 * Cobros con monto libre — la parte que habla con la base de datos.
 * Las reglas puras (id virtual, conversión del monto, plan) viven en
 * `custom-payment-rules.ts`; ver allí el porqué del diseño.
 */

/**
 * El producto oculto al que cuelgan la matrícula y el pago de todo cobro libre.
 *
 * Se crea aquí y no en la migración: el valor `OTHER` del enum es nuevo y
 * Postgres no deja usarlo en la misma transacción que lo añade. `upsert` con
 * `update` vacío lo hace idempotente y a prueba de dos enlaces creados a la vez.
 *
 * `isActive: false` es lo que lo mantiene fuera de todo: el catálogo público,
 * `/servicios`, los selectores de producto del panel y `getActiveProducts`
 * leen sólo los activos. Nada lo vende; sólo recibe lo que ya se cobró.
 */
export const ensureCustomPaymentProduct = async (): Promise<void> => {
  await prisma.product.upsert({
    where: { id: CUSTOM_PAYMENT_PRODUCT_ID },
    update: {},
    create: {
      id: CUSTOM_PAYMENT_PRODUCT_ID,
      kind: ProductKind.OTHER,
      title: "Pago personalizado",
      sessionsLabel: "Pago único",
      isActive: false,
      sortOrder: 9999,
    },
  });
};

/**
 * Las condiciones (monto, moneda, concepto) del enlace al que apunta un id de
 * plan libre, o `null` si el id no es de un enlace o el enlace no las tiene.
 *
 * **No mira si el enlace está revocado, vencido o pagado, y es a propósito.**
 * Esto se usa también para comprobar lo cobrado en la captura y el webhook, y
 * un pago que el cliente completa 20 minutos después de que el enlace venza
 * ya está cobrado: rechazarlo sería quedarse con el dinero sin matrícula. Esa
 * puerta —no empezar pagos nuevos con un enlace muerto— está en
 * `authorizeCustomPlanOrder`, que es donde de verdad corresponde.
 */
export const getCustomTerms = async (
  planId: string,
): Promise<ResolvedCustomTerms | null> => {
  const linkId = parseCustomPlanId(planId);
  if (!linkId) return null;
  const link = await prisma.paymentLink.findUnique({
    where: { id: linkId },
    select: {
      id: true,
      customAmountMinor: true,
      customCurrency: true,
      customConcept: true,
    },
  });
  return link ? customTermsFromLink(link) : null;
};

export const getCustomPlan = async (planId: string): Promise<Plan | null> => {
  const terms = await getCustomTerms(planId);
  return terms ? customPlanFromTerms(terms) : null;
};

/**
 * ¿Puede empezar ahora un pago con este id de plan?
 *
 * Para un producto normal no hay nada que comprobar y devuelve `true`: el
 * catálogo es público a propósito. Un plan libre, en cambio, cuesta lo que
 * Dayana escribió en ESE enlace, así que sólo quien tiene su token puede abrir
 * una orden — y sólo mientras el enlace esté vivo y sin pagar. Sin esto bastaría
 * con conocer el id (que viaja en peticiones del navegador) para abrir órdenes
 * contra enlaces revocados o ya cobrados.
 *
 * Un enlace libre se paga una vez: pagado, deja de aceptar órdenes. Evita el
 * doble cobro de quien vuelve a abrir el mismo enlace.
 */
export const authorizeCustomPlanOrder = async (
  planId: string,
  token: unknown,
): Promise<boolean> => {
  const linkId = parseCustomPlanId(planId);
  if (!linkId) return true;
  if (typeof token !== "string" || !token.trim()) return false;

  const link = await prisma.paymentLink.findUnique({
    where: { token: token.trim() },
    select: { id: true, revokedAt: true, expiresAt: true, paidAt: true },
  });
  if (!link || link.id !== linkId) return false;
  if (link.revokedAt || link.paidAt) return false;
  if (link.expiresAt && link.expiresAt < new Date()) return false;
  return true;
};
