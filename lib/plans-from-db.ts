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

  return {
    id: product.id,
    kind,
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
  const coursePlan =
    plans.find((p) => p.id === "course-live") ??
    plans.find((p) => p.kind === "course" && p.id !== "workshop-virtual") ??
    null;
  return { therapyPlans, coursePlan, allPlans: plans, usdToCopRate };
};

export const getPlanFromDb = async (planId: string): Promise<Plan | null> => {
  const product = await prisma.product.findUnique({
    where: { id: planId },
    include: {
      prices: {
        orderBy: { validFrom: "desc" },
      },
    },
  });
  if (!product || !product.isActive || product.isCourseContent) {
    return null;
  }
  // Sin derivación automática: el plan lleva exactamente los precios del
  // CRM. Sin fila COP → amountCop queda undefined y el flujo COP se niega.
  return productToPlan(product);
};

export const isActivePlanId = async (planId: string): Promise<boolean> => {
  const product = await prisma.product.findUnique({
    where: { id: planId },
    select: { isActive: true, isCourseContent: true },
  });
  // Un curso de la biblioteca no es comprable: el checkout lo rechaza aquí,
  // que es el único punto por el que pasan PayPal, Mercado Pago y la cotización.
  return Boolean(product?.isActive && !product.isCourseContent);
};
