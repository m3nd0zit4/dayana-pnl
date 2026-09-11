import { ProductAccent, ProductKind } from "@prisma/client";
import { prisma } from "../db";
import { uniqueSlug } from "./slug";

const priceInclude = {
  prices: {
    orderBy: { validFrom: "desc" as const },
  },
} as const;

/**
 * Lo que Paquetes lista: los productos que se COBRAN.
 *
 * El filtro es el mismo de `getActiveProducts` (lib/crm/products.ts) menos el
 * `isActive`, porque el panel sí tiene que ver lo desactivado — es donde se
 * vuelve a activar. No es un criterio inventado para esta pantalla: es el
 * predicado que decide si algo puede cobrarse.
 *
 * Antes devolvía TODO, y la mitad de Paquetes eran los ocho cursos de la
 * biblioteca: filas `isCourseContent` sin precio, marcadas «Sin precio · No
 * visible», que no se venden y que se editan en Cursos → Módulos. Estaban ahí
 * por descuido, y traían dos problemas de verdad:
 *
 * - Reordenar con las flechas manda la lista ENTERA a `reorderProducts`, que
 *   reescribe cada id a 0..n-1. La numeración que los cursos traen de
 *   `content/curriculum/*(/)curso.json` (5, 10, 20 … 70) se aplastaba de una
 *   pulsada, y el siguiente `seed-curriculum` la devolvía: dos ordenaciones
 *   peleándose.
 * - El icono de la papelera quedaba a un clic de un curso con módulos,
 *   lecciones y progreso de alumnas. Ver `deactivateProduct`.
 */
export const listSellableProducts = async () =>
  prisma.product.findMany({
    where: { OR: [{ isCourseContent: false }, { sellsStandalone: true }] },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    include: priceInclude,
  });

export const createProduct = async (input: {
  id?: string;
  kind: ProductKind;
  title: string;
  imageUrl?: string | null;
  sessionsLabel: string;
  sessionsCount?: number | null;
  description?: string;
  /**
   * Campos de presentación: lo que la tarjeta pública enseña además del
   * precio. Vivían sólo en el seed y en `scripts/backfill-product-content.ts`,
   * así que Dayana no podía poner un "Más elegido" ni cambiar el mensaje de
   * WhatsApp sin que alguien tocara código.
   */
  tag?: string | null;
  highlight?: boolean;
  unitPriceLabel?: string | null;
  therapyHeadline?: string | null;
  whatsappMessage?: string | null;
  accent?: ProductAccent;
  amountUsd: number;
  listAmountUsd?: number | null;
  amountCop?: number | null;
  listAmountCop?: number | null;
  sortOrder?: number;
}) => {
  const id =
    input.id?.trim() ||
    (await uniqueSlug(input.title, async (slug) => {
      const found = await prisma.product.findUnique({ where: { id: slug } });
      return !!found;
    }));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error("INVALID_ID");
  }

  if (
    input.kind === ProductKind.THERAPY &&
    (!input.sessionsCount || input.sessionsCount < 1)
  ) {
    throw new Error("THERAPY_REQUIRES_SESSIONS");
  }

  if (
    input.kind === ProductKind.WORKSHOP &&
    !(input.amountCop != null && input.amountCop > 0)
  ) {
    throw new Error("WORKSHOP_REQUIRES_COP");
  }

  const maxOrder = await prisma.product.aggregate({ _max: { sortOrder: true } });
  const sortOrder = input.sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 1;

  const priceRows = [
    {
      currency: "USD",
      amountMinor: Math.round(input.amountUsd * 100),
      listAmountMinor: input.listAmountUsd ? Math.round(input.listAmountUsd * 100) : null,
    },
    ...(input.amountCop != null
      ? [
          {
            currency: "COP",
            amountMinor: Math.round(input.amountCop),
            listAmountMinor: input.listAmountCop
              ? Math.round(input.listAmountCop)
              : null,
          },
        ]
      : []),
  ];

  const product = await prisma.product.create({
    data: {
      id,
      kind: input.kind,
      title: input.title.trim(),
      imageUrl: input.imageUrl?.trim() || null,
      sessionsLabel: input.sessionsLabel.trim(),
      sessionsCount: input.sessionsCount ?? null,
      description: input.description?.trim() || null,
      tag: input.tag?.trim() || null,
      highlight: input.highlight ?? false,
      unitPriceLabel: input.unitPriceLabel?.trim() || null,
      therapyHeadline: input.therapyHeadline?.trim() || null,
      whatsappMessage: input.whatsappMessage?.trim() || null,
      accent: input.accent,
      isActive: true,
      sortOrder,
      prices: { create: priceRows },
    },
    include: priceInclude,
  });

  return product;
};

/**
 * Reordena el catálogo. Mismo contrato que `reorderCourseModules`: llega la
 * lista completa de ids en su orden nuevo y se reescribe `sortOrder` de una
 * vez, en transacción, para que no quede a medias.
 */
export const reorderProducts = async (orderedIds: string[]) => {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.product.update({ where: { id }, data: { sortOrder: index } })
    )
  );
};

export const updateProduct = async (
  id: string,
  input: {
    title?: string;
    imageUrl?: string | null;
    sessionsLabel?: string;
    sessionsCount?: number | null;
    description?: string;
    isActive?: boolean;
    kind?: ProductKind;
    /**
       * Campos de presentación: lo que la tarjeta pública enseña además del
       * precio. Vivían sólo en el seed y en `scripts/backfill-product-content.ts`,
       * así que Dayana no podía poner un "Más elegido" ni cambiar el mensaje de
       * WhatsApp sin que alguien tocara código.
         */
    tag?: string | null;
    highlight?: boolean;
    unitPriceLabel?: string | null;
    therapyHeadline?: string | null;
    whatsappMessage?: string | null;
    accent?: ProductAccent;
    amountUsd?: number;
    listAmountUsd?: number | null;
    amountCop?: number | null;
    listAmountCop?: number | null;
    sortOrder?: number;
  }
) => {
  const existing = await prisma.product.findUnique({
    where: { id },
    include: priceInclude,
  });
  if (!existing) throw new Error("NOT_FOUND");

  /**
   * Un producto con plan recurrente no puede cambiar de precio por aquí.
   *
   * Escribir `ProductPrice` a secas dejaría a la web anunciando un importe que
   * los planes de PayPal y Mercado Pago no cobran, porque ellos llevan la cifra
   * horneada dentro. Ese camino pasa por `changeSubscriptionPrice`
   * (`lib/pricing/price-sync.ts`), que sólo persiste después de que los dos
   * proveedores hayan aceptado. La guarda está aquí y no en la ruta para que
   * tampoco se cuele desde un script o desde una ruta nueva.
   */
  const touchesPrice =
    input.amountUsd !== undefined ||
    input.amountCop !== undefined ||
    input.listAmountUsd !== undefined ||
    input.listAmountCop !== undefined;
  if (
    touchesPrice &&
    (existing.paypalPlanId || existing.mercadoPagoPreapprovalPlanId)
  ) {
    throw new Error("USE_CHANGE_SUBSCRIPTION_PRICE");
  }

  const nextKind = input.kind ?? existing.kind;
  const nextSessions =
    input.sessionsCount !== undefined ? input.sessionsCount : existing.sessionsCount;
  if (nextKind === ProductKind.THERAPY && (!nextSessions || nextSessions < 1)) {
    throw new Error("THERAPY_REQUIRES_SESSIONS");
  }

  const nextAmountCop =
    input.amountCop !== undefined
      ? input.amountCop
      : existing.prices.find((p) => p.currency === "COP")?.amountMinor ?? null;
  if (nextKind === ProductKind.WORKSHOP && !(nextAmountCop != null && nextAmountCop > 0)) {
    throw new Error("WORKSHOP_REQUIRES_COP");
  }

  await prisma.product.update({
    where: { id },
    data: {
      title: input.title?.trim(),
      imageUrl:
        input.imageUrl !== undefined ? input.imageUrl?.trim() || null : undefined,
      sessionsLabel: input.sessionsLabel?.trim(),
      sessionsCount: input.sessionsCount,
      description: input.description?.trim(),
      // `undefined` deja el valor como está; `null` lo borra. Por eso se
      // comprueba `!== undefined` en vez de usar `||`: un campo vaciado a
      // propósito tiene que poder vaciarse.
      tag: input.tag !== undefined ? input.tag?.trim() || null : undefined,
      highlight: input.highlight,
      unitPriceLabel:
        input.unitPriceLabel !== undefined
          ? input.unitPriceLabel?.trim() || null
          : undefined,
      therapyHeadline:
        input.therapyHeadline !== undefined
          ? input.therapyHeadline?.trim() || null
          : undefined,
      whatsappMessage:
        input.whatsappMessage !== undefined
          ? input.whatsappMessage?.trim() || null
          : undefined,
      accent: input.accent,
      isActive: input.isActive,
      kind: input.kind,
      sortOrder: input.sortOrder,
    },
  });

  if (input.amountUsd !== undefined) {
    const amountMinor = Math.round(input.amountUsd * 100);
    const listAmountMinor =
      input.listAmountUsd != null ? Math.round(input.listAmountUsd * 100) : null;
    const latestUsd = existing.prices.find((p) => p.currency === "USD");
    if (
      !latestUsd ||
      latestUsd.amountMinor !== amountMinor ||
      latestUsd.listAmountMinor !== listAmountMinor
    ) {
      await prisma.productPrice.create({
        data: { productId: id, currency: "USD", amountMinor, listAmountMinor },
      });
    }
  }

  if (input.amountCop !== undefined) {
    if (input.amountCop == null) {
      await prisma.productPrice.deleteMany({ where: { productId: id, currency: "COP" } });
    } else {
      const amountMinor = Math.round(input.amountCop);
      const listAmountMinor =
        input.listAmountCop != null ? Math.round(input.listAmountCop) : null;
      const latestCop = existing.prices.find((p) => p.currency === "COP");
      if (
        !latestCop ||
        latestCop.amountMinor !== amountMinor ||
        latestCop.listAmountMinor !== listAmountMinor
      ) {
        await prisma.productPrice.create({
          data: { productId: id, currency: "COP", amountMinor, listAmountMinor },
        });
      }
    }
  }

  return prisma.product.findUnique({
    where: { id },
    include: priceInclude,
  });
};

/**
 * «Eliminar» un producto: desactivar casi siempre, borrar sólo cuando no queda
 * nada colgando.
 *
 * Contaba matrículas y nada más, y eso no bastaba ni de lejos. Un curso de la
 * biblioteca normalmente tiene CERO matrículas —el acceso viene de la
 * mensualidad, no de una matrícula por curso (lib/lms/membership.ts)— así que
 * caía en la rama del borrado duro, y `product.delete` arrastra en cascada sus
 * módulos, sus lecciones con los ids de Mux, y con ellas el progreso, los
 * intentos de test, las respuestas escritas y los comentarios de cada alumna.
 * El contenido se puede volver a sembrar desde `content/curriculum/**`; lo que
 * escribieron las alumnas, no.
 *
 * Así que ahora se pregunta por todo lo que el borrado se llevaría:
 *
 * - **Módulos o clases** — es contenido del curso. Se desactiva.
 * - **Un plan de suscripción** — la fila es el ÚNICO sitio donde vive el
 *   puntero al plan de PayPal o de Mercado Pago, y ninguno de los dos deja
 *   borrar un plan, sólo desactivarlo. Sin la fila queda un plan huérfano
 *   cobrando y nada en el CRM que lo diga.
 * - **Matrículas** — como antes.
 *
 * Devuelve qué hizo, para que el panel pueda decir por qué no se borró en vez
 * de dejarlo en un «no se pudo» sin motivo.
 */
export type DeactivateProductResult = {
  /** `deleted` sólo cuando de verdad se borró la fila. */
  outcome: "deleted" | "deactivated";
  /** Por qué se desactivó en vez de borrarse. Vacío si se borró. */
  reason: string | null;
  product: Awaited<ReturnType<typeof listSellableProducts>>[number] | null;
};

export const deactivateProduct = async (
  id: string
): Promise<DeactivateProductResult> => {
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      paypalPlanId: true,
      mercadoPagoPreapprovalPlanId: true,
      _count: {
        select: { enrollments: true, courseModules: true, liveClassSessions: true },
      },
    },
  });
  if (!product) throw new Error("NOT_FOUND");

  const { enrollments, courseModules, liveClassSessions } = product._count;

  const reason =
    courseModules > 0 || liveClassSessions > 0
      ? `Es contenido de curso: ${courseModules} módulo(s) y ${liveClassSessions} ` +
        "clase(s) con el progreso de las alumnas. Se desactivó en vez de borrarse."
      : product.paypalPlanId || product.mercadoPagoPreapprovalPlanId
        ? "Tiene un plan de suscripción, y los proveedores no dejan borrar un " +
          "plan. Borrar la ficha dejaría el plan cobrando sin nada que lo " +
          "señale, así que se desactivó."
        : enrollments > 0
          ? `Tiene ${enrollments} matrícula(s). Se desactivó en vez de borrarse.`
          : null;

  if (reason) {
    return {
      outcome: "deactivated",
      reason,
      product: await prisma.product.update({
        where: { id },
        data: { isActive: false },
        include: priceInclude,
      }),
    };
  }

  await prisma.productPrice.deleteMany({ where: { productId: id } });
  await prisma.product.delete({ where: { id } });
  return { outcome: "deleted", reason: null, product: null };
};
