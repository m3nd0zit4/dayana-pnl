import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/db";
import { getPlanFromDb } from "@/lib/plans-from-db";
import { isPlanVisibleForRegion } from "@/lib/pricing/plan-visibility";
import type { Plan } from "@/lib/plans";

/**
 * Enlaces de pago: una página con un solo producto, generada desde el panel.
 *
 * El precio **nunca** viaja en el enlace. Se resuelve del producto en cada
 * carga, igual que en cualquier otra página pública, así que un token
 * manipulado no puede cambiar un importe: lo único que decide es qué producto
 * se muestra y a quién se saluda.
 */

/** 32 caracteres hex = 128 bits, igual que el token del cuestionario. */
const newToken = () => randomBytes(16).toString("hex");

export type PaymentLinkRow = {
  id: string;
  token: string;
  note: string | null;
  expiresAt: Date | null;
  openedAt: Date | null;
  checkoutStartedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  product: { id: string; title: string };
  /// Nulo cuando el enlace se generó sin ficha, y también cuando la ficha se
  /// borró después: el enlace es un hecho del negocio y sobrevive a la
  /// limpieza de un contacto.
  contact: { id: string; firstName: string; lastName: string | null } | null;
};

const SELECT = {
  id: true,
  token: true,
  note: true,
  expiresAt: true,
  openedAt: true,
  checkoutStartedAt: true,
  revokedAt: true,
  createdAt: true,
  product: { select: { id: true, title: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
} as const;

export async function createPaymentLink(input: {
  contactId: string;
  productId: string;
  note?: string | null;
  /** Días hasta que caduque. Sin valor, no caduca. */
  expiresInDays?: number | null;
  staffUserId?: string | null;
}): Promise<PaymentLinkRow> {
  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  return prisma.paymentLink.create({
    data: {
      token: newToken(),
      contactId: input.contactId,
      productId: input.productId,
      note: input.note?.trim() || null,
      expiresAt,
      createdByStaffId: input.staffUserId ?? null,
    },
    select: SELECT,
  });
}

export async function listPaymentLinksForContact(
  contactId: string,
): Promise<PaymentLinkRow[]> {
  return prisma.paymentLink.findMany({
    where: { contactId },
    orderBy: { createdAt: "desc" },
    select: SELECT,
  });
}

export async function listRecentPaymentLinks(
  limit = 100,
): Promise<PaymentLinkRow[]> {
  return prisma.paymentLink.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: SELECT,
  });
}

export async function revokePaymentLink(id: string): Promise<void> {
  // `updateMany` con guarda: revocar dos veces no reescribe la primera fecha,
  // que es la que dice cuándo dejó de valer.
  await prisma.paymentLink.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export type ResolvedPaymentLink = {
  token: string;
  note: string | null;
  plan: Plan;
  contact: {
    id: string;
    firstName: string;
    email: string | null;
    phoneE164: string;
  } | null;
};

/**
 * Resuelve un enlace para la página pública.
 *
 * Devuelve `null` —404— por cualquier motivo: token inexistente, revocado,
 * caducado, producto retirado o sin precio en la moneda del visitante. Los
 * casos no se distinguen a propósito: quién tenga un token que ya no vale no
 * gana nada sabiendo por qué.
 */
export async function resolvePaymentLink(
  token: string,
  isColombia: boolean,
): Promise<ResolvedPaymentLink | null> {
  const link = await prisma.paymentLink.findUnique({
    where: { token },
    select: {
      token: true,
      note: true,
      revokedAt: true,
      expiresAt: true,
      productId: true,
      contact: {
        select: { id: true, firstName: true, email: true, phoneE164: true },
      },
    },
  });

  if (!link || link.revokedAt) return null;
  if (link.expiresAt && link.expiresAt < new Date()) return null;

  // El precio sale del catálogo, no del enlace. `getPlanFromDb` ya rechaza los
  // productos que no son comprables (los cursos de la biblioteca), así que un
  // enlace apuntando a uno de esos responde 404 en vez de pintar un botón que
  // fallaría en el checkout.
  const plan = await getPlanFromDb(link.productId).catch(() => null);
  if (!plan || !isPlanVisibleForRegion(plan, isColombia)) return null;

  return {
    token: link.token,
    note: link.note,
    plan,
    contact: link.contact,
  };
}

/**
 * El enlace FIJO de un paquete: `/pagar/p/<productId>`.
 *
 * No hay fila en `payment_links` que resolver — este enlace no caduca, no se
 * revoca y no lleva contacto. Lo unico que queda por comprobar es que el
 * producto siga siendo comprable, y eso son las mismas dos puertas que aplica
 * `resolvePaymentLink`: `getPlanFromDb` rechaza los contenedores de curso de
 * la biblioteca, e `isPlanVisibleForRegion` rechaza un producto sin precio en
 * la moneda de quien mira. Sin ellas se publicaria un boton que revienta al
 * llegar al checkout.
 *
 * Devuelve `null` —404— por cualquiera de los dos motivos, sin distinguirlos.
 */
export async function resolveDefaultProductLink(
  productId: string,
  isColombia: boolean,
): Promise<{ plan: Plan } | null> {
  const plan = await getPlanFromDb(productId).catch(() => null);
  if (!plan || !isPlanVisibleForRegion(plan, isColombia)) return null;
  return { plan };
}

/** Sella la primera apertura. Recargar no mueve la fecha. */
export async function markPaymentLinkOpened(token: string): Promise<void> {
  await prisma.paymentLink.updateMany({
    where: { token, openedAt: null },
    data: { openedAt: new Date() },
  });
}

export async function markPaymentLinkCheckoutStarted(
  token: string,
): Promise<void> {
  await prisma.paymentLink.updateMany({
    where: { token, checkoutStartedAt: null },
    data: { checkoutStartedAt: new Date() },
  });
}
