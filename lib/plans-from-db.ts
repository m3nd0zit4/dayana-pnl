import { ProductKind } from "@prisma/client";
import { getActiveProducts, latestCopPrice, latestUsdPrice } from "./crm/products";
import { resolveUsdToCopRate } from "./crm/site-settings";
import { applyCopToPlan } from "./pricing/usd-to-cop";
import { PLANS, type Plan, type PlanId } from "./plans";
import { prisma } from "./db";

const kindToPlanKind = (kind: ProductKind): Plan["kind"] =>
  kind === ProductKind.THERAPY ? "therapy" : "course";

const featuresFromDescription = (description: string | null, fallback: string[]) => {
  if (!description?.trim()) return fallback;
  const lines = description.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 ? lines : fallback;
};

export const productToPlan = (
  product: Awaited<ReturnType<typeof getActiveProducts>>[number]
): Plan => {
  const fallback = PLANS[product.id as PlanId];
  const usdPrice = latestUsdPrice(product);
  const copPrice = latestCopPrice(product);

  const amountUsd = usdPrice ? usdPrice.amountMinor / 100 : fallback?.amountUsd ?? 0;
  const listAmountUsd = usdPrice?.listAmountMinor
    ? usdPrice.listAmountMinor / 100
    : fallback?.listAmountUsd;

  // COP stored as full pesos (no centavos), so amountMinor = pesos directly
  const amountCop = copPrice ? copPrice.amountMinor : undefined;
  const listAmountCop = copPrice?.listAmountMinor ?? undefined;

  const kind = kindToPlanKind(product.kind);

  return {
    id: product.id as PlanId,
    kind,
    title: product.title,
    sessions: product.sessionsLabel,
    sessionsCount: product.sessionsCount ?? fallback?.sessionsCount,
    amountUsd,
    listAmountUsd,
    amountCop,
    listAmountCop,
    unitPrice: fallback?.unitPrice,
    tag: fallback?.tag,
    highlight: fallback?.highlight,
    therapyPresentation:
      kind === "therapy"
        ? fallback?.therapyPresentation ?? {
            sessionsHeadline: product.sessionsLabel,
          }
        : undefined,
    features: featuresFromDescription(product.description, fallback?.features ?? []),
    whatsappMessage:
      fallback?.whatsappMessage ??
      `Hola Dayana, me interesa ${product.title} ($${amountUsd} USD).`,
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
  const usdToCopRate = await resolveUsdToCopRate();
  const product = await prisma.product.findUnique({
    where: { id: planId },
    include: {
      prices: {
        orderBy: { validFrom: "desc" },
      },
    },
  });
  if (!product || !product.isActive) {
    const fallback = PLANS[planId as PlanId];
    return fallback ? applyCopToPlan(fallback, usdToCopRate) : null;
  }
  const plan = productToPlan(product);
  if (plan.amountCop == null) {
    return applyCopToPlan(plan, usdToCopRate);
  }
  return plan;
};

export const isActivePlanId = async (planId: string): Promise<boolean> => {
  const product = await prisma.product.findUnique({
    where: { id: planId },
    select: { isActive: true },
  });
  if (product) return product.isActive;
  return planId in PLANS;
};
