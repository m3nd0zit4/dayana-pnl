/**
 * Crea el plan de suscripción mensual de Mercado Pago y guarda su id.
 *
 *   bun run scripts/mercadopago/setup-subscription.ts
 *
 * Con `bun run`, no `bunx tsx`: bun carga `.env` solo.
 *
 * ## El precio lleva la comisión horneada
 *
 * Un `preapproval_plan` cobra un importe FIJO, igual que un Billing Plan de
 * PayPal, así que el gross-up va dentro. **Cambiar `MERCADOPAGO_FEE_PERCENT`
 * obliga a re-ejecutar esto**, y MP tampoco deja borrar planes: se crea uno
 * nuevo y las suscripciones vivas siguen en el viejo.
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
import { PrismaClient } from "@prisma/client";
import { grossUpInt, mercadoPagoFee } from "../../lib/pricing/fees";
import { createPreapprovalPlan } from "../../lib/mercadopago/subscriptions";

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

  if (product.mercadoPagoPreapprovalPlanId) {
    console.log(
      `Ya existe un plan: ${product.mercadoPagoPreapprovalPlanId}\n` +
        `MP no deja borrarlos. Si el precio cambió, esto creará OTRO y las\n` +
        `suscripciones vivas seguirán cobrando por el viejo.`
    );
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!base) throw new Error("Falta NEXT_PUBLIC_SITE_URL");

  const plan = await createPreapprovalPlan({
    reason: `${product.title} — mensualidad`,
    amountCop: gross,
    backUrl: `${base}/pago/exito?suscripcion=1`,
  });

  await db.product.update({
    where: { id: product.id },
    data: { mercadoPagoPreapprovalPlanId: plan.id },
  });

  console.log(`Plan creado y guardado: ${plan.id}`);
  console.log("\nRecuerda: cambiar las comisiones obliga a re-ejecutar esto.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
