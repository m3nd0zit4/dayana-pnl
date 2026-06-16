import { ProductKind } from "@prisma/client";
import { getActiveProducts, latestUsdPrice } from "./crm/products";
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
  const price = latestUsdPrice(product);
  const amountUsd = price ? price.amountMinor / 100 : fallback?.amountUsd ?? 0;
  const listAmountUsd = price?.listAmountMinor
    ? price.listAmountMinor / 100
    : fallback?.listAmountUsd;

  const kind = kindToPlanKind(product.kind);

  return {
    id: product.id as PlanId,
    kind,
    title: product.title,
    sessions: product.sessionsLabel,
    amountUsd,
    listAmountUsd,
    amountCop: fallback?.amountCop,
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
  const products = await getActiveProducts();
  const plans = products.map(productToPlan);
  const therapyPlans = plans.filter((p) => p.kind === "therapy");
  const coursePlan =
    plans.find((p) => p.id === "course-live") ??
    plans.find((p) => p.kind === "course" && p.id !== "workshop-virtual") ??
    null;
  return { therapyPlans, coursePlan, allPlans: plans };
};

export const getPlanFromDb = async (planId: string): Promise<Plan | null> => {
  const product = await prisma.product.findUnique({
    where: { id: planId },
    include: {
      prices: {
        where: { currency: "USD" },
        orderBy: { validFrom: "desc" },
        take: 1,
      },
    },
  });
  if (!product || !product.isActive) {
    const fallback = PLANS[planId as PlanId];
    return fallback ?? null;
  }
  return productToPlan(product);
};

export const isActivePlanId = async (planId: string): Promise<boolean> => {
  const product = await prisma.product.findUnique({
    where: { id: planId },
    select: { isActive: true },
  });
  if (product) return product.isActive;
  return planId in PLANS;
};
