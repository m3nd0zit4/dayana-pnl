/**
 * Crea (o reutiliza) el Product y el Billing Plan mensual de PayPal para la
 * mensualidad, y guarda sus ids en `Product`.
 *
 *   bunx tsx scripts/paypal/setup-subscription.ts
 *
 * ## El precio lleva la comisión horneada
 *
 * Un Billing Plan cobra un importe FIJO. No hay forma de calcular el gross-up
 * por cobro como hacen `create-order` y Mercado Pago, así que el importe del
 * plan ya incluye la comisión de PayPal. Consecuencia: **si cambias
 * `PAYPAL_FEE_PERCENT` o `PAYPAL_FEE_FIXED`, hay que volver a ejecutar esto**,
 * y como PayPal no permite borrar planes —sólo desactivarlos— se creará uno
 * nuevo y las suscripciones vivas seguirán en el viejo hasta que migren.
 *
 * El id va en `Product`, nunca en `ProductPrice`: esa tabla es el histórico de
 * precios públicos y su fila más reciente es la que se pinta en la web, así que
 * escribir ahí el importe con comisión inflaría el precio de cara a la clienta.
 */
import { PrismaClient } from "@prisma/client";
import { grossUpUsd, paypalFee } from "../../lib/pricing/fees";
import { paypalClient } from "../../lib/paypal/subscriptions";

const db = new PrismaClient();

const api = async (path: string, body?: unknown) => {
  const client = paypalClient();
  const base =
    process.env.PAYPAL_MODE?.toLowerCase() === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");
  const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  void client;

  const res = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return json as Record<string, unknown>;
};

async function main() {
  // La mensualidad es el único COURSE que no es contenido de biblioteca; misma
  // definición que usa `getMembershipProduct` en lib/lms/membership.ts.
  const product = await db.product.findFirst({
    where: { kind: "COURSE", isActive: true, isCourseContent: false },
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
    const created = await api("/v1/catalogs/products", {
      name: product.title.slice(0, 127),
      description: (product.description ?? product.title).slice(0, 256),
      type: "SERVICE",
      category: "EDUCATIONAL_AND_TEXTBOOKS",
    });
    paypalProductId = created.id as string;
    console.log(`Product de PayPal creado: ${paypalProductId}`);
  } else {
    console.log(`Product de PayPal ya existía: ${paypalProductId}`);
  }

  const plan = await api("/v1/billing/plans", {
    product_id: paypalProductId,
    name: `${product.title} — mensual`.slice(0, 127),
    description: `Acceso mensual. ${gross.toFixed(2)} USD incluye la comisión de procesamiento.`.slice(0, 127),
    status: "ACTIVE",
    billing_cycles: [
      {
        frequency: { interval_unit: "MONTH", interval_count: 1 },
        tenure_type: "REGULAR",
        sequence: 1,
        // 0 = sin fin. La suscripción vive hasta que se cancele.
        total_cycles: 0,
        pricing_scheme: {
          fixed_price: { value: gross.toFixed(2), currency_code: "USD" },
        },
      },
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee_failure_action: "CONTINUE",
      // Tras 3 intentos fallidos PayPal suspende. El acceso NO se corta aquí:
      // lo decide `paidUntil` al vencer.
      payment_failure_threshold: 3,
    },
  });

  await db.product.update({
    where: { id: product.id },
    data: { paypalProductId, paypalPlanId: plan.id as string },
  });

  console.log(`Billing Plan creado y guardado: ${plan.id}`);
  console.log("\nRecuerda: cambiar las comisiones obliga a re-ejecutar esto.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
