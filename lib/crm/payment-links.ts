import { randomBytes, randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { fireNotification } from "@/lib/notifications/platform/emit";
import { getPlanFromDb } from "@/lib/plans-from-db";
import { isPlanVisibleForRegion } from "@/lib/pricing/plan-visibility";
import type { Plan } from "@/lib/plans";

import { ensureCustomPaymentProduct } from "./custom-payment";
import {
  CUSTOM_PAYMENT_PRODUCT_ID,
  customPlanFromTerms,
  customPlanIdFor,
  customTermsFromLink,
  formatCustomAmount,
  parseCustomPlanId,
  type CustomCurrency,
} from "./custom-payment-rules";

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
  paidAt: Date | null;
  enrollmentId: string | null;
  createdAt: Date;
  /** Monto libre: los tres o ninguno. Ver `PaymentLink.customAmountMinor`. */
  customAmountMinor: number | null;
  customCurrency: string | null;
  customConcept: string | null;
  product: { id: string; title: string };
  /** Las opciones adicionales, si el enlace ofrece varias. */
  options: { productId: string; product: { title: string } }[];
  /** `null` cuando el enlace se creo sin ficha, o si la ficha se borro. */
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
  paidAt: true,
  enrollmentId: true,
  createdAt: true,
  customAmountMinor: true,
  customCurrency: true,
  customConcept: true,
  product: { select: { id: true, title: true } },
  options: {
    select: { productId: true, product: { select: { title: true } } },
    orderBy: { sortOrder: "asc" },
  },
  contact: { select: { id: true, firstName: true, lastName: true } },
} as const;

/**
 * Prefijo del telefono provisional de un comprador dado de alta desde un
 * enlace de pago con nombre y correo pero sin numero.
 *
 * **No es `+pending`**, y la diferencia importa: ese prefijo marca los pagos
 * como «sin identificar» en el panel y esconde la ficha de las listas del CRM.
 * Esta ficha la escribio Dayana a proposito y tiene nombre y correo reales;
 * tratarla como una compra anonima seria justo lo contrario de lo que se
 * busca. Mismo criterio que `+google` y `+signup`, que ya existen por esto.
 *
 * Va tambien en `PLACEHOLDER_PHONE_PREFIXES` de `lib/meta/capi-hash.ts`: sin
 * eso este numero inventado viajaria a Meta como si fuera el telefono real de
 * alguien.
 */
export const LINK_BUYER_PLACEHOLDER_PHONE_PREFIX = "+nophone";

export type PaymentLinkBuyer = {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  phoneCountry?: string | null;
  email?: string | null;
};

/**
 * Resuelve —o crea— la ficha de un comprador escrito a mano al crear el
 * enlace. Devuelve `null` si no se escribio nada: el enlace se crea igual y el
 * pago sigue el camino anonimo normal.
 *
 * Acepta **telefono O correo**, no los dos. `upsertContactByPhone` exige
 * telefono y lanza `INVALID_PHONE` sin el, asi que el caso «nombre + correo»
 * no tenia via: se resuelve buscando por correo primero —`Contact.email` es
 * unico— y creando con telefono provisional si no existe.
 *
 * Con **solo el nombre** tambien se crea la ficha, con telefono provisional:
 * Dayana a veces solo sabe como se llama la persona, y el enlace debe
 * saludarla y colgar el cobro de su ficha. Los datos de contacto llegan
 * despues, con el pago.
 */
export async function resolvePaymentLinkBuyer(
  buyer: PaymentLinkBuyer | undefined | null,
): Promise<string | null> {
  const firstName = buyer?.firstName?.trim() || undefined;
  const lastName = buyer?.lastName?.trim() || undefined;
  const email = buyer?.email?.trim().toLowerCase() || undefined;
  const phone = buyer?.phone?.trim() || undefined;

  if (!phone && !email) {
    if (!firstName) return null;
    const created = await prisma.contact.create({
      data: {
        phoneE164: `${LINK_BUYER_PLACEHOLDER_PHONE_PREFIX}:${randomUUID()}`,
        firstName,
        ...(lastName ? { lastName } : {}),
        source: "WHATSAPP_DIRECT",
        sourceDetail: "enlace de pago",
      },
      select: { id: true },
    });
    return created.id;
  }

  if (phone) {
    const { upsertContactByPhone } = await import("./contacts");
    const { contact } = await upsertContactByPhone({
      phone,
      phoneCountry: buyer?.phoneCountry?.trim() || undefined,
      firstName,
      lastName,
      email,
      source: "WHATSAPP_DIRECT",
      sourceDetail: "enlace de pago",
    });
    return contact.id;
  }

  const existing = await prisma.contact.findUnique({
    where: { email: email! },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.contact.create({
    data: {
      phoneE164: `${LINK_BUYER_PLACEHOLDER_PHONE_PREFIX}:${randomUUID()}`,
      firstName: firstName || email!,
      ...(lastName ? { lastName } : {}),
      email: email!,
      source: "WHATSAPP_DIRECT",
      sourceDetail: "enlace de pago",
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Sella el enlace como cobrado cuando entra el pago.
 *
 * Se busca por **contacto + producto** y no por el token, porque el token no
 * viaja hasta aqui: el unico portador hasta la conciliacion seria la
 * referencia del checkout, que va firmada y cabe en 127 caracteres en el
 * `custom_id` de PayPal — no hay sitio para 32 mas.
 *
 * Limitacion conocida y aceptada: si hay dos enlaces vivos del mismo producto
 * para la misma persona, se sella el mas antiguo sin cobrar. No es una mala
 * atribucion del dinero —el cobro y la matricula son correctos en los dos
 * casos—, solo de cual de los dos enlaces se uso.
 *
 * **Solo enlaces CON ficha.** Uno abierto es reutilizable a proposito: no
 * tiene un comprador unico, y marcarlo cobrado lo daria por consumido cuando
 * puede seguir sirviendo.
 *
 * Nunca lanza: esto es contabilidad del panel y no puede tumbar un cobro.
 */
export async function markPaymentLinkPaid(input: {
  contactId: string;
  productId: string;
  enrollmentId: string;
}): Promise<void> {
  try {
    // Un enlace de monto libre se sella por su id exacto, que viaja en el id de
    // plan. Buscar por «contacto + producto» aquí sería ambiguo justo en el caso
    // que este enlace existe para cubrir: varios cobros de importes distintos a
    // la misma persona. Se sella aunque no tenga ficha: se paga una sola vez.
    const customLinkId = parseCustomPlanId(input.productId);
    if (customLinkId) {
      const sealed = await prisma.paymentLink.updateMany({
        where: { id: customLinkId, paidAt: null },
        data: { paidAt: new Date(), enrollmentId: input.enrollmentId },
      });
      if (sealed.count === 0) {
        // Ya estaba cobrado. Lo normal es el reintento del MISMO cobro (la
        // misma matrícula) y no pasa nada. Si es OTRA matrícula, la persona
        // pagó dos veces —dos pestañas, dos órdenes abiertas a la vez—: el
        // dinero ya entró y no se rechaza, pero el equipo tiene que saberlo
        // para devolver el que sobra.
        const link = await prisma.paymentLink.findUnique({
          where: { id: customLinkId },
          select: { enrollmentId: true, customConcept: true },
        });
        if (link?.enrollmentId && link.enrollmentId !== input.enrollmentId) {
          fireNotification({
            eventType: "PAYMENT_WEBHOOK_FAILED",
            title: "Enlace de monto libre cobrado dos veces",
            body: `«${link.customConcept ?? "Pago personalizado"}» ya estaba pagado y entró otro cobro. Revisa los pagos y devuelve el que sobre.`,
            href: `/admin/enrollments/${input.enrollmentId}`,
            entityType: "Enrollment",
            entityId: input.enrollmentId,
            staff: "ALL",
          });
        }
      }
      return;
    }

    const pending = await prisma.paymentLink.findFirst({
      where: {
        contactId: input.contactId,
        // Un enlace con varias opciones se cobra por CUALQUIERA de ellas: lo
        // que se pagó es una de las que se ofrecieron.
        OR: [
          { productId: input.productId },
          { options: { some: { productId: input.productId } } },
        ],
        paidAt: null,
        revokedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!pending) return;

    await prisma.paymentLink.updateMany({
      where: { id: pending.id, paidAt: null },
      data: { paidAt: new Date(), enrollmentId: input.enrollmentId },
    });
  } catch (e) {
    console.error("[payment-links] no se pudo sellar el cobro", e);
  }
}

export async function createPaymentLink(input: {
  /** Opcional: un enlace puede crearse sin saber todavia a quien se manda. */
  contactId?: string | null;
  /** La primera opcion. Con `productIds` es la primera de la lista. */
  productId?: string;
  /**
   * Monto libre en lugar de un producto del catálogo. Excluyente con
   * `productId` y `extraProductIds`: un enlace cobra UNA cosa, y lo que se
   * cobra aquí es exactamente este importe. Llega ya validado y convertido
   * (`customAmountToMinor`); aquí sólo se guarda.
   */
  custom?: { amountMinor: number; currency: CustomCurrency; concept: string };
  /**
   * Las demas opciones, cuando el enlace ofrece varias para elegir. La
   * primera se guarda ademas en `productId` para que todo lo que ya leia el
   * enlace siga funcionando sin cambios.
   */
  extraProductIds?: string[];
  note?: string | null;
  /** Días hasta que caduque. Sin valor, no caduca. */
  expiresInDays?: number | null;
  staffUserId?: string | null;
}): Promise<PaymentLinkRow> {
  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  if (input.custom) {
    if (input.productId || input.extraProductIds?.length) {
      throw new Error("CUSTOM_LINK_HAS_PRODUCT");
    }
    // El producto oculto tiene que existir antes de la clave foránea.
    await ensureCustomPaymentProduct();
  } else if (!input.productId) {
    throw new Error("MISSING_PRODUCT");
  }

  const productId = input.custom
    ? CUSTOM_PAYMENT_PRODUCT_ID
    : (input.productId as string);

  const extras = (input.extraProductIds ?? []).filter(
    (id) => id && id !== productId,
  );

  return prisma.paymentLink.create({
    data: {
      token: newToken(),
      contactId: input.contactId ?? null,
      productId,
      ...(input.custom
        ? {
            customAmountMinor: input.custom.amountMinor,
            customCurrency: input.custom.currency,
            customConcept: input.custom.concept,
          }
        : {}),
      note: input.note?.trim() || null,
      expiresAt,
      createdByStaffId: input.staffUserId ?? null,
      options: extras.length
        ? {
            create: [...new Set(extras)].map((productId, i) => ({
              productId,
              sortOrder: i + 1,
            })),
          }
        : undefined,
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
  /** La primera opcion: la unica que hay cuando el enlace ofrece una sola. */
  plan: Plan;
  /** Todas las opciones visibles para quien mira, en orden. */
  plans: Plan[];
  /**
   * A quien se le manda, si se sabe. `null` en un enlace abierto: la pagina
   * saluda sin nombre y el pago sigue el camino anonimo normal.
   */
  contact: {
    id: string;
    firstName: string;
    email: string | null;
    phoneE164: string;
  } | null;
  /**
   * Presente sólo en un enlace de monto libre. La página lo trata distinto: la
   * moneda decide el riel (no el país de quien mira), el precio se pinta con
   * centavos, y un enlace ya cobrado enseña «ya está pagado» en vez de 404.
   */
  custom?: {
    currency: CustomCurrency;
    /** «$250.00 USD» / «$500.000 COP», listo para pintar. */
    amountLabel: string;
    paid: boolean;
  };
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
      id: true,
      token: true,
      note: true,
      revokedAt: true,
      expiresAt: true,
      paidAt: true,
      productId: true,
      customAmountMinor: true,
      customCurrency: true,
      customConcept: true,
      options: { select: { productId: true }, orderBy: { sortOrder: "asc" } },
      contact: {
        select: { id: true, firstName: true, email: true, phoneE164: true },
      },
    },
  });

  if (!link || link.revokedAt) return null;
  if (link.expiresAt && link.expiresAt < new Date()) return null;

  // Monto libre: el precio es el del propio enlace, no el de un producto, y el
  // riel lo decide la moneda — por eso no se pasa por `isPlanVisibleForRegion`,
  // que escondería un enlace en USD a quien lo abre desde Colombia.
  const terms = customTermsFromLink(link);
  if (terms) {
    const plan = customPlanFromTerms(terms);
    return {
      token: link.token,
      note: link.note,
      plan,
      plans: [plan],
      contact: link.contact,
      custom: {
        currency: terms.currency,
        amountLabel: formatCustomAmount(terms.amountMinor, terms.currency),
        paid: link.paidAt !== null,
      },
    };
  }

  // El precio sale del catálogo, no del enlace. `getPlanFromDb` ya rechaza los
  // productos que no son comprables (los cursos de la biblioteca), así que un
  // enlace apuntando a uno de esos responde 404 en vez de pintar un botón que
  // fallaría en el checkout.
  const ids = [link.productId, ...link.options.map((o) => o.productId)];
  const resolved = await Promise.all(
    ids.map((id) => getPlanFromDb(id).catch(() => null)),
  );
  // Una opción retirada, o sin precio en la moneda de quien mira, sale de la
  // lista en vez de pintar un botón que fallaría en el checkout. Si no queda
  // ninguna, el enlace responde 404 igual que antes.
  const plans = resolved.filter(
    (plan): plan is Plan => !!plan && isPlanVisibleForRegion(plan, isColombia),
  );
  if (plans.length === 0) return null;

  return {
    token: link.token,
    note: link.note,
    plan: plans[0],
    plans,
    contact: link.contact,
  };
}

/**
 * El enlace FIJO de un paquete: `/pagar/p/<id>`.
 *
 * No hay fila que resolver. El enlace por defecto de un paquete no es un
 * `PaymentLink`, es una ruta — y esa es toda la diferencia:
 *
 * - **No caduca y no se revoca**, porque no hay nada que caducar. Se copia una
 *   vez y sirve siempre.
 * - **No lleva contacto**, que es lo que lo hace seguro de compartir. Un enlace
 *   con contacto usado por cincuenta personas cuelga los cincuenta cobros de la
 *   misma ficha: `resolveCheckoutContactIdForPayment` resuelve por el enlace
 *   antes de mirar el correo y el teléfono que la compradora acaba de escribir.
 * - **No mide nada.** `openedAt` y `checkoutStartedAt` se sellan una sola vez
 *   por fila; en un enlace compartido contarían a la primera visitante y
 *   mentirían sobre el resto. Mejor no dar un número que dar uno falso.
 *
 * Las puertas son las MISMAS que las del enlace con token, y a propósito: si
 * divergieran, un producto retirado seguiría cobrando por una de las dos vías.
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
    where: { token, openedAt: null, revokedAt: null },
    data: { openedAt: new Date() },
  });
}

export async function markPaymentLinkCheckoutStarted(
  token: string,
): Promise<void> {
  await prisma.paymentLink.updateMany({
    where: { token, checkoutStartedAt: null, revokedAt: null },
    data: { checkoutStartedAt: new Date() },
  });
}

/**
 * El contacto y el producto de un enlace, para la creacion de la orden.
 *
 * Separado de `resolvePaymentLink` a proposito: aquella resuelve el PLAN para
 * pintar la pagina y depende de la region del visitante; esta responde una
 * sola pregunta —a quien pertenece este cobro— y no debe depender de la geo,
 * porque quien ya esta pagando no puede perder su ficha por viajar.
 *
 * Devuelve `null` si el enlace no existe, esta revocado o caduco. Nunca acepta
 * un `contactId` que venga del navegador: el token es el unico dato que
 * autoriza a colgar un pago de una ficha ajena, y es un secreto de 128 bits
 * que solo tiene quien recibio el enlace.
 */
export async function resolvePaymentLinkOwner(
  token: string,
): Promise<{ contactId: string | null; productIds: string[] } | null> {
  const clean = token.trim();
  if (!clean) return null;

  const link = await prisma.paymentLink.findUnique({
    where: { token: clean },
    select: {
      id: true,
      contactId: true,
      productId: true,
      customAmountMinor: true,
      options: { select: { productId: true } },
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (!link || link.revokedAt) return null;
  if (link.expiresAt && link.expiresAt < new Date()) return null;

  // Un enlace libre ofrece un solo «plan»: el suyo, con id propio. El producto
  // oculto al que cuelga la matrícula no es lo que se ofrece ni se compra.
  if (link.customAmountMinor) {
    return { contactId: link.contactId, productIds: [customPlanIdFor(link.id)] };
  }

  return {
    contactId: link.contactId,
    // Cualquiera de las opciones ofrecidas cuelga el cobro de su ficha; un
    // producto que este enlace no ofrece, no.
    productIds: [link.productId, ...link.options.map((o) => o.productId)],
  };
}
