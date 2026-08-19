/**
 * Mirrors the sellable catalogue into Stripe as Products + Prices.
 *
 *   bunx tsx scripts/stripe/setup-products.ts --dry-run
 *   bunx tsx scripts/stripe/setup-products.ts
 *
 * Idempotent: re-running updates the existing Stripe Product in place and only
 * creates a new Price when the amount actually changed (Stripe Prices are
 * immutable, so a price change is always a new object — the old one is
 * deactivated, never deleted, so historical subscriptions keep billing).
 *
 * The amount pushed to Stripe carries the fee gross-up (lib/pricing/fees.ts):
 * Checkout charges Price objects, so unlike PayPal there is no per-request
 * calculation. Changing STRIPE_FEE_PERCENT / STRIPE_FEE_FIXED means re-running
 * this script.
 */
import { prisma } from "../../lib/db";
import { getActiveProducts, latestUsdPrice } from "../../lib/crm/products";
import { grossUpUsd, stripeFee } from "../../lib/pricing/fees";
import { getStripe } from "../../lib/payments/stripe/client";
import { classifyProductForStripe } from "../../lib/payments/stripe/eligibility";

const DRY_RUN = process.argv.includes("--dry-run");

/** Only the monthly membership gets a recurring Price. */
const RECURRING_PRODUCT_IDS = new Set(["course-live"]);

type Row = {
  productId: string;
  title: string;
  taxCode: string;
  managedPayments: boolean;
  reason: string;
  stripeProductId: string;
  oneTimePriceId: string;
  recurringPriceId: string | null;
  amountUsd: string;
};

const log = (...args: unknown[]) => console.log("[stripe:setup]", ...args);

async function main() {
  // --dry-run must work without credentials: it is the "what would this do"
  // pass you run before anyone has pasted a key into .env.
  const stripe = DRY_RUN ? null : getStripe();
  const fee = stripeFee();
  const products = await getActiveProducts();
  const rows: Row[] = [];

  log(
    `${products.length} productos vendibles · gross-up ${(fee.percent * 100).toFixed(2)}% + $${fee.fixed}${DRY_RUN ? " · DRY RUN" : ""}`
  );

  for (const product of products) {
    const usd = latestUsdPrice(product);
    if (!usd || usd.amountMinor <= 0) {
      log(`· ${product.id}: sin precio USD, se omite`);
      continue;
    }

    const { taxCode, managedPayments, reason } = classifyProductForStripe({
      id: product.id,
      kind: product.kind,
    });

    // The plan price is what Dayana wants NET; the customer pays the gross.
    // Managed Payments then adds tax on top of that (tax_behavior: exclusive).
    const { gross } = grossUpUsd(usd.amountMinor / 100, fee);
    const unitAmount = Math.round(gross * 100);

    const description =
      product.description?.split("\n")[0]?.trim() || product.sessionsLabel;

    if (DRY_RUN) {
      rows.push({
        productId: product.id,
        title: product.title,
        taxCode,
        managedPayments,
        reason,
        stripeProductId: product.stripeProductId ?? "(nuevo)",
        oneTimePriceId: product.stripePriceId ?? "(nuevo)",
        recurringPriceId: RECURRING_PRODUCT_IDS.has(product.id)
          ? (product.stripeRecurringPriceId ?? "(nuevo)")
          : "—",
        amountUsd: (unitAmount / 100).toFixed(2),
      });
      continue;
    }

    // ── Product ────────────────────────────────────────────────────────────
    const api = stripe ?? getStripe();
    let stripeProductId = product.stripeProductId;
    if (stripeProductId) {
      await api.products.update(stripeProductId, {
        name: product.title,
        description,
        tax_code: taxCode,
        metadata: { planId: product.id, kind: product.kind },
      });
    } else {
      const created = await api.products.create({
        name: product.title,
        description,
        tax_code: taxCode,
        metadata: { planId: product.id, kind: product.kind },
      });
      stripeProductId = created.id;
    }

    // ── Prices ─────────────────────────────────────────────────────────────
    const oneTimePriceId = await ensurePrice({
      currentPriceId: product.stripePriceId,
      stripeProductId,
      unitAmount,
      recurring: false,
    });

    let recurringPriceId: string | null = null;
    if (RECURRING_PRODUCT_IDS.has(product.id)) {
      recurringPriceId = await ensurePrice({
        currentPriceId: product.stripeRecurringPriceId,
        stripeProductId,
        unitAmount,
        recurring: true,
      });
    }

    await prisma.product.update({
      where: { id: product.id },
      data: {
        stripeProductId,
        stripeTaxCode: taxCode,
        stripeManagedPayments: managedPayments,
        stripePriceId: oneTimePriceId,
        stripeRecurringPriceId: recurringPriceId,
      },
    });

    rows.push({
      productId: product.id,
      title: product.title,
      taxCode,
      managedPayments,
      reason,
      stripeProductId,
      oneTimePriceId,
      recurringPriceId,
      amountUsd: (unitAmount / 100).toFixed(2),
    });
    log(`✓ ${product.id}`);
  }

  console.log("\n" + "─".repeat(78));
  console.table(
    rows.map((r) => ({
      plan: r.productId,
      USD: r.amountUsd,
      "tax code": r.taxCode,
      MP: r.managedPayments ? "SÍ" : "no",
      product: r.stripeProductId,
      "price (pago único)": r.oneTimePriceId,
      "price (suscripción)": r.recurringPriceId ?? "—",
    }))
  );
  console.log("Managed Payments (MP) por producto:");
  for (const r of rows) {
    console.log(`  · ${r.productId}: ${r.managedPayments ? "ON" : "OFF"} — ${r.reason}`);
  }
  if (DRY_RUN) {
    console.log("\nDRY RUN: no se creó nada en Stripe ni en la base de datos.");
  }
}

/**
 * Returns the Stripe Price id for this product+cadence, creating one only when
 * the amount changed. Stripe Prices are immutable, so "update" means create a
 * new Price and deactivate the old one — never delete it, or subscriptions
 * already billing against it break.
 */
async function ensurePrice(input: {
  currentPriceId: string | null;
  stripeProductId: string;
  unitAmount: number;
  recurring: boolean;
}): Promise<string> {
  const stripe = getStripe();

  if (input.currentPriceId) {
    const current = await stripe.prices
      .retrieve(input.currentPriceId)
      .catch(() => null);
    if (current) {
      if (current.active && current.unit_amount === input.unitAmount) {
        return current.id;
      }
      await stripe.prices.update(current.id, { active: false });
    }
  }

  const price = await stripe.prices.create({
    product: input.stripeProductId,
    currency: "usd",
    unit_amount: input.unitAmount,
    // Managed Payments reads the price's tax behavior; `exclusive` means tax is
    // added on top, which is the Dashboard default.
    tax_behavior: "exclusive",
    ...(input.recurring ? { recurring: { interval: "month" as const } } : {}),
  });

  return price.id;
}

main()
  .catch((e) => {
    console.error("[stripe:setup] falló", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
