/**
 * Deja el Product y el Billing Plan mensual de PayPal alineados con el precio
 * del CRM, y guarda sus ids en `Product`.
 *
 *   bunx tsx scripts/paypal/setup-subscription.ts
 *
 * ## Es idempotente: si ya hay plan, se ACTUALIZA
 *
 * Antes cada corrida creaba un plan nuevo y sobrescribía el id guardado, así
 * que las suscripciones vivas se quedaban cobrando por un plan que ya nadie
 * miraba — la forma más silenciosa de cobrar un precio que no es el anunciado.
 * Ahora se usa `update-pricing-schemes`, que además **alcanza a las
 * suscripciones existentes** (salvo los cobros de los 10 días siguientes).
 *
 * ## El precio lleva la comisión horneada
 *
 * Un Billing Plan cobra un importe FIJO, no calculado por cobro como en
 * `create-order`, así que el importe del plan ya incluye la comisión. Cambiar
 * `PAYPAL_FEE_PERCENT` o `PAYPAL_FEE_FIXED` obliga a volver a ejecutar esto —
 * y si se olvida, el cron `subscription-price-drift-check` lo canta.
 *
 * El id va en `Product`, nunca en `ProductPrice`: esa tabla es el histórico de
 * precios públicos y su fila más reciente es la que se pinta en la web, así que
 * escribir ahí el importe con comisión inflaría el precio de cara a la clienta.
 */
import { PaymentProvider, PrismaClient } from "@prisma/client";
import { grossUpUsd, paypalFee } from "../../lib/pricing/fees";
import {
  billingPlanGrossMinor,
  createBillingPlan,
  createPayPalCatalogProduct,
  getBillingPlan,
  updateBillingPlanPricing,
} from "../../lib/paypal/plans";

const db = new PrismaClient();

async function main() {
  // La mensualidad es el único COURSE que no es contenido de biblioteca; misma
  // definición que usa `getMembershipProduct` en lib/lms/membership.ts.
  const product = await db.product.findFirst({
    // Sólo la mensualidad. `findFirst` no llevaba orden ni excluía la
    // anualidad, así que con las dos vivas podía devolver la anual y repuntar
    // el plan recurrente a su importe: cobrarle un año a quien pagó por meses.
    where: {
      kind: "COURSE",
      isActive: true,
      isCourseContent: false,
      OR: [{ membershipMonths: null }, { membershipMonths: { lte: 1 } }],
    },
    orderBy: { sortOrder: "asc" },
    include: { prices: { where: { currency: "USD" }, orderBy: { validFrom: "desc" }, take: 1 } },
  });
  if (!product) throw new Error("No hay producto de mensualidad activo");

  const netCents = product.prices[0]?.amountMinor;
  if (!netCents) throw new Error(`${product.id} no tiene precio USD`);

  const { net, fee, gross } = grossUpUsd(netCents / 100, paypalFee());
  console.log(`Producto : ${product.id} — ${product.title}`);
  console.log(`Neto     : ${net.toFixed(2)} USD`);
  console.log(`Comisión : ${fee.toFixed(2)} USD`);
  console.log(`Se cobra : ${gross.toFixed(2)} USD/mes\n`);

  let paypalProductId = product.paypalProductId;
  if (!paypalProductId) {
    paypalProductId = await createPayPalCatalogProduct({
      title: product.title,
      description: product.description,
    });
    console.log(`Product de PayPal creado: ${paypalProductId}`);
  } else {
    console.log(`Product de PayPal ya existía: ${paypalProductId}`);
  }

  const grossMinor = Math.round(gross * 100);
  let planId = product.paypalPlanId;

  if (planId) {
    // Actualizar, jamás crear otro: un plan nuevo dejaría a las suscripciones
    // vivas cobrando por el viejo.
    const live = billingPlanGrossMinor(await getBillingPlan(planId));
    if (live === grossMinor) {
      console.log(`El plan ${planId} ya cobra ${gross.toFixed(2)} USD. Nada que hacer.`);
    } else {
      await updateBillingPlanPricing(planId, gross);
      console.log(
        `Plan ${planId} actualizado: ${live != null ? (live / 100).toFixed(2) : "?"} → ${gross.toFixed(2)} USD`
      );
      console.log("Alcanza también a las suscripciones vivas (salvo cobros dentro de 10 días).");
    }
  } else {
    const created = await createBillingPlan({
      paypalProductId,
      title: product.title,
      grossUsd: gross,
    });
    planId = created.id;
    console.log(`Billing Plan creado: ${planId}`);
  }

  await db.product.update({
    where: { id: product.id },
    data: { paypalProductId, paypalPlanId: planId },
  });

  // El testigo de que PayPal aceptó este importe. Es contra esto que se
  // comparan los cobros que van llegando.
  await db.productPriceSync.create({
    data: {
      productId: product.id,
      provider: PaymentProvider.PAYPAL,
      currency: "USD",
      grossMinor,
      netMinor: netCents,
      externalPlanId: planId,
    },
  });

  console.log(`\nGuardado en ${product.id}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
