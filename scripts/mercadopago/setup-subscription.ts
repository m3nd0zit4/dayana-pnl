/**
 * Crea el plan de suscripción mensual de Mercado Pago y guarda su id.
 *
 *   bun run scripts/mercadopago/setup-subscription.ts
 *
 * Con `bun run`, no `bunx tsx`: bun carga `.env` solo.
 *
 * ## Es idempotente: si ya hay plan, se ACTUALIZA
 *
 * Antes cada corrida creaba otro plan y las suscripciones vivas seguían
 * cobrando por el viejo. Ahora se hace `PUT /preapproval_plan/{id}`. Ojo: eso
 * cubre a quien se suscriba de aquí en adelante; que alcance a las
 * suscripciones YA vivas no lo documenta MP, así que de eso se encarga la
 * función `subscription-price-propagate-mp`, que las recorre una a una.
 *
 * ## El precio lleva la comisión horneada
 *
 * Un `preapproval_plan` cobra un importe FIJO, igual que un Billing Plan de
 * PayPal, así que el gross-up va dentro. **Cambiar `MERCADOPAGO_FEE_PERCENT`
 * obliga a re-ejecutar esto** — y si se olvida, el cron
 * `subscription-price-drift-check` lo canta.
 *
 * El id va en `Product`, nunca en `ProductPrice`: esa tabla es el precio
 * público y su fila más reciente es la que se pinta en la web.
 *
 * ## Sólo tarjeta
 *
 * El cobro recurrente de MP no admite PSE, Nequi ni efectivo — necesita un
 * medio que pueda debitar sin la clienta delante. Por eso la suscripción NO
 * reemplaza al pago suelto en Colombia: conviven.
 */
import { PaymentProvider, PrismaClient } from "@prisma/client";
import { grossUpInt, mercadoPagoFee } from "../../lib/pricing/fees";
import {
  createPreapprovalPlan,
  getPreapprovalPlan,
  updatePreapprovalPlan,
} from "../../lib/mercadopago/subscriptions";

const db = new PrismaClient();

async function main() {
  const product = await db.product.findFirst({
    where: { kind: "COURSE", isActive: true, isCourseContent: false },
    include: {
      prices: {
        where: { currency: "COP" },
        orderBy: { validFrom: "desc" },
        take: 1,
      },
    },
  });
  if (!product) throw new Error("No hay producto de mensualidad activo");

  // COP se guarda en pesos enteros, sin centavos (ver CLAUDE.md).
  const net = product.prices[0]?.amountMinor;
  if (!net) {
    throw new Error(
      `${product.id} no tiene precio COP. La suscripción de Mercado Pago cobra en COP.`
    );
  }

  const { fee, gross } = grossUpInt(net, mercadoPagoFee());
  console.log(`Producto : ${product.id} — ${product.title}`);
  console.log(`Neto     : ${net.toLocaleString("es-CO")} COP`);
  console.log(`Comisión : ${fee.toLocaleString("es-CO")} COP`);
  console.log(`Se cobra : ${gross.toLocaleString("es-CO")} COP/mes\n`);

  let planId = product.mercadoPagoPreapprovalPlanId;

  if (planId) {
    const live = (await getPreapprovalPlan(planId)).auto_recurring
      ?.transaction_amount;
    if (live != null && Math.round(live) === gross) {
      console.log(`El plan ${planId} ya cobra ${gross.toLocaleString("es-CO")} COP. Nada que hacer.`);
    } else {
      await updatePreapprovalPlan(planId, gross);
      console.log(
        `Plan ${planId} actualizado: ${live != null ? Math.round(live).toLocaleString("es-CO") : "?"} → ${gross.toLocaleString("es-CO")} COP`
      );
      console.log(
        "Cubre a las nuevas altas. Para las suscripciones vivas, el cambio de\n" +
          "precio desde el CRM dispara la propagación una a una."
      );
    }
  } else {
    const base = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (!base) throw new Error("Falta NEXT_PUBLIC_SITE_URL");

    const plan = await createPreapprovalPlan({
      reason: `${product.title} — mensualidad`,
      amountCop: gross,
      backUrl: `${base}/pago/exito?suscripcion=1`,
    });
    planId = plan.id;
    console.log(`Plan creado: ${planId}`);
  }

  await db.product.update({
    where: { id: product.id },
    data: { mercadoPagoPreapprovalPlanId: planId },
  });

  // El testigo de que MP aceptó este importe: contra esto se comparan los
  // cobros que van llegando.
  await db.productPriceSync.create({
    data: {
      productId: product.id,
      provider: PaymentProvider.MERCADO_PAGO,
      currency: "COP",
      grossMinor: gross,
      netMinor: net,
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
