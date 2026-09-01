import { ProductKind } from "@prisma/client";
import { getActiveProducts, latestCopPrice, latestUsdPrice } from "./crm/products";
import { resolveUsdToCopRate } from "./crm/site-settings";
import type { Plan } from "./plans";
import { prisma } from "./db";

const kindToPlanKind = (kind: ProductKind): Plan["kind"] =>
  kind === ProductKind.THERAPY ? "therapy" : "course";

const featuresFromDescription = (description: string | null): string[] => {
  if (!description?.trim()) return [];
  return description
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
};

/**
 * La DB es la única fuente de verdad del catálogo: Product lleva el
 * contenido (título, features, tag, WhatsApp) y ProductPrice los precios.
 */
export const productToPlan = (
  product: Awaited<ReturnType<typeof getActiveProducts>>[number]
): Plan => {
  const usdPrice = latestUsdPrice(product);
  const copPrice = latestCopPrice(product);

  const amountUsd = usdPrice ? usdPrice.amountMinor / 100 : 0;
  const listAmountUsd = usdPrice?.listAmountMinor
    ? usdPrice.listAmountMinor / 100
    : undefined;

  // COP stored as full pesos (no centavos), so amountMinor = pesos directly
  const amountCop = copPrice ? copPrice.amountMinor : undefined;
  const listAmountCop = copPrice?.listAmountMinor ?? undefined;

  const kind = kindToPlanKind(product.kind);

  /**
   * La mensualidad, y sólo ella. `kind` no vale para esto: un taller también
   * llega aquí como `"course"` y se paga una vez.
   */
  const recurring =
    product.kind === ProductKind.COURSE && !product.isCourseContent;

  return {
    id: product.id,
    kind,
    recurring,
    libraryCourse: product.isCourseContent || undefined,
    // Que el producto sea recurrente no basta: hace falta que el plan exista
    // en el proveedor, o el botón lleva a un error.
    subscriptionAvailable:
      recurring &&
      Boolean(product.paypalPlanId || product.mercadoPagoPreapprovalPlanId),
    title: product.title,
    sessions: product.sessionsLabel,
    sessionsCount: product.sessionsCount ?? undefined,
    amountUsd,
    listAmountUsd,
    amountCop,
    listAmountCop,
    imageUrl: product.imageUrl ?? undefined,
    unitPrice: product.unitPriceLabel ?? undefined,
    membershipMonths: product.membershipMonths ?? undefined,
    tag: product.tag ?? undefined,
    highlight: product.highlight || undefined,
    therapyPresentation:
      kind === "therapy"
        ? {
            sessionsHeadline: product.therapyHeadline ?? product.sessionsLabel,
          }
        : undefined,
    features: featuresFromDescription(product.description),
    whatsappMessage:
      product.whatsappMessage ??
      `Hola Dayana, me interesa ${product.title}.`,
  };
};

export const getPublicPlans = async () => {
  const usdToCopRate = await resolveUsdToCopRate();
  const products = await getActiveProducts();
  // amountCop stays undefined if not stored — caller filters cards without a price
  const plans = products.map(productToPlan);
  const therapyPlans = plans.filter((p) => p.kind === "therapy");
  // Los cursos de la biblioteca que se venden sueltos. Van aparte porque
  // `coursePlan` significa «la mensualidad» en todos los llamantes actuales.
  const courseLibrary = plans.filter((p) => p.libraryCourse);
  const coursePlan =
    plans.find((p) => p.id === "course-live") ??
    // El respaldo excluye los cursos de biblioteca: desde que existe la venta
    // suelta entran en `plans`, y sin este filtro un curso cualquiera podía
    // acabar presentándose como la mensualidad en /servicios y en el taller.
    plans.find(
      (p) => p.kind === "course" && !p.libraryCourse && p.id !== "workshop-virtual"
    ) ??
    null;
  return { therapyPlans, coursePlan, courseLibrary, allPlans: plans, usdToCopRate };
};

/**
 * ¿Se puede cobrar este producto?
 *
 * El único criterio, y compartido a propósito: `getPlanFromDb` e
 * `isActivePlanId` son la puerta por la que pasan PayPal, Mercado Pago y la
 * cotización. Con dos copias del predicado, una se queda atrás y aparece un
 * producto cobrable por una vía e inexistente por otra.
 *
 * Un curso de la biblioteca no es comprable salvo que se haya publicado
 * expresamente para venta suelta.
 */
const isSellable = (product: {
  isActive: boolean;
  isCourseContent: boolean;
  sellsStandalone: boolean;
}): boolean =>
  product.isActive && (!product.isCourseContent || product.sellsStandalone);

export const getPlanFromDb = async (planId: string): Promise<Plan | null> => {
  const product = await prisma.product.findUnique({
    where: { id: planId },
    include: {
      prices: {
        orderBy: { validFrom: "desc" },
      },
    },
  });
  if (!product || !isSellable(product)) {
    return null;
  }
  // Sin derivación automática: el plan lleva exactamente los precios del
  // CRM. Sin fila COP → amountCop queda undefined y el flujo COP se niega.
  return productToPlan(product);
};

export const isActivePlanId = async (planId: string): Promise<boolean> => {
  const product = await prisma.product.findUnique({
    where: { id: planId },
    select: { isActive: true, isCourseContent: true, sellsStandalone: true },
  });
  return Boolean(product && isSellable(product));
};
