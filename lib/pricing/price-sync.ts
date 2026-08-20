/**
 * El precio de la mensualidad, sincronizado con los planes de los proveedores.
 *
 * ## El problema que resuelve
 *
 * Un pago suelto calcula su importe en cada petición, así que cambiar el precio
 * en el CRM basta. Una suscripción no: PayPal y Mercado Pago cobran un importe
 * **horneado dentro del plan**. Hasta ahora, cambiar el precio en el panel
 * cambiaba lo que anunciaba la web y dejaba a los planes cobrando lo de antes,
 * sin que nada avisara.
 *
 * ## La regla
 *
 * **Primero confirman los proveedores, después se persiste.** `ProductPrice`
 * —la tabla cuya fila más reciente pinta la web— no se escribe hasta que PayPal
 * y Mercado Pago han aceptado el importe nuevo. Por eso es imposible que la web
 * anuncie un precio que los planes no estén cobrando ya: ese precio no llega a
 * existir en la base.
 *
 * El precio de la web es el NETO y el del plan es el BRUTO (con la comisión
 * encima), así que la comparación correcta siempre es
 * `grossUp(neto) === importe del plan`. Comparar los netos con los brutos es
 * justo el error que este módulo existe para no cometer.
 */

import { PaymentProvider, type Prisma, type Product } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  billingPlanGrossMinor,
  getBillingPlan,
  updateBillingPlanPricing,
} from "@/lib/paypal/plans";
import {
  getPreapprovalPlan,
  updatePreapprovalPlan,
} from "@/lib/mercadopago/subscriptions";
import {
  grossUpInt,
  grossUpUsd,
  mercadoPagoFee,
  paypalFee,
} from "@/lib/pricing/fees";

export type PriceSyncFailureCode =
  | "NOT_A_SUBSCRIPTION_PRODUCT"
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_DRIFTED"
  | "CONCURRENT_CHANGE"
  | "PAYPAL_FAILED"
  | "MERCADOPAGO_FAILED"
  | "PAYPAL_REVERT_FAILED";

export type ChangeSubscriptionPriceResult =
  | { ok: true; changed: boolean; product: Product; newGrossUsd: number | null }
  | { ok: false; code: PriceSyncFailureCode; message: string };

/** ¿Este producto cobra por un plan recurrente de algún proveedor? */
export const hasSubscriptionPlan = (product: {
  paypalPlanId: string | null;
  mercadoPagoPreapprovalPlanId: string | null;
}): boolean =>
  Boolean(product.paypalPlanId || product.mercadoPagoPreapprovalPlanId);

const usdMinorToGross = (netMinor: number): number =>
  grossUpUsd(netMinor / 100, paypalFee()).gross;

const copToGross = (netCop: number): number =>
  grossUpInt(netCop, mercadoPagoFee()).gross;

const productWithPrices = {
  prices: { orderBy: { validFrom: "desc" as const } },
} as const;

type ProductWithPrices = Prisma.ProductGetPayload<{
  include: typeof productWithPrices;
}>;

const latestMinor = (product: ProductWithPrices, currency: "USD" | "COP") =>
  product.prices.find((p) => p.currency === currency) ?? null;

/**
 * Cambia el precio de un producto de suscripción.
 *
 * Devuelve `ok: false` sin haber tocado nada en casi todos los fallos; la única
 * excepción es `PAYPAL_REVERT_FAILED`, donde PayPal ya cobra el importe nuevo y
 * no se pudo deshacer. Ese caso marca el producto como `DRIFTED` para que quede
 * a la vista, y aun así **no escribe el precio**: es preferible que la web
 * anuncie de menos a que anuncie algo que nadie cobra.
 */
export const changeSubscriptionPrice = async (
  productId: string,
  input: { amountUsd?: number; amountCop?: number | null },
  options: { staffUserId?: string } = {}
): Promise<ChangeSubscriptionPriceResult> => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: productWithPrices,
  });
  if (!product) {
    return { ok: false, code: "PRODUCT_NOT_FOUND", message: "Producto no encontrado." };
  }
  if (!hasSubscriptionPlan(product)) {
    return {
      ok: false,
      code: "NOT_A_SUBSCRIPTION_PRODUCT",
      message: "Este producto no tiene plan de suscripción.",
    };
  }
  if (product.priceSyncStatus === "DRIFTED") {
    return {
      ok: false,
      code: "PRODUCT_DRIFTED",
      message:
        "El precio está descuadrado con los proveedores. Reconcilia antes de volver a cambiarlo.",
    };
  }

  const currentUsd = latestMinor(product, "USD");
  const currentCop = latestMinor(product, "COP");

  const nextUsdMinor =
    input.amountUsd !== undefined ? Math.round(input.amountUsd * 100) : null;
  const nextCopMinor =
    input.amountCop !== undefined && input.amountCop !== null
      ? Math.round(input.amountCop)
      : null;

  const usdChanges =
    nextUsdMinor != null && nextUsdMinor !== (currentUsd?.amountMinor ?? null);
  const copChanges =
    nextCopMinor != null && nextCopMinor !== (currentCop?.amountMinor ?? null);

  // Mismo criterio de dedupe que `updateProduct`: si el neto no se movió, no se
  // molesta a nadie. Además evita el 422 de PayPal por mandar el mismo importe.
  if (!usdChanges && !copChanges) {
    return { ok: true, changed: false, product, newGrossUsd: null };
  }

  const touchPayPal = usdChanges && Boolean(product.paypalPlanId);
  const touchMercadoPago =
    copChanges && Boolean(product.mercadoPagoPreapprovalPlanId);

  const newGrossUsd = nextUsdMinor != null ? usdMinorToGross(nextUsdMinor) : null;
  const newGrossCop = nextCopMinor != null ? copToGross(nextCopMinor) : null;
  const previousGrossUsd =
    currentUsd != null ? usdMinorToGross(currentUsd.amountMinor) : null;

  // 1) PayPal. Si falla, a Mercado Pago no se le llega a llamar.
  if (touchPayPal && newGrossUsd != null) {
    try {
      await updateBillingPlanPricing(product.paypalPlanId!, newGrossUsd);
    } catch (e) {
      return {
        ok: false,
        code: "PAYPAL_FAILED",
        message: `PayPal rechazó el cambio de precio, así que no se guardó nada. ${errText(e)}`,
      };
    }
  }

  // 2) Mercado Pago. Si falla, se deshace lo de PayPal.
  if (touchMercadoPago && newGrossCop != null) {
    try {
      await updatePreapprovalPlan(
        product.mercadoPagoPreapprovalPlanId!,
        newGrossCop
      );
    } catch (e) {
      const mpError = errText(e);
      if (!touchPayPal || previousGrossUsd == null) {
        return {
          ok: false,
          code: "MERCADOPAGO_FAILED",
          message: `Mercado Pago rechazó el cambio de precio, así que no se guardó nada. ${mpError}`,
        };
      }
      try {
        await updateBillingPlanPricing(product.paypalPlanId!, previousGrossUsd);
        return {
          ok: false,
          code: "MERCADOPAGO_FAILED",
          message: `Mercado Pago rechazó el cambio de precio. Se deshizo el de PayPal y no se guardó nada. ${mpError}`,
        };
      } catch (revertError) {
        /**
         * Lo peor que puede pasar, y por eso es lo único que deja marca: PayPal
         * ya cobra el importe nuevo y no se pudo devolver al viejo. El precio
         * NO se guarda —la web sigue anunciando el anterior— y el producto
         * queda señalado hasta que alguien reconcilie a mano.
         */
        const note =
          `PayPal cobra ${newGrossUsd?.toFixed(2)} USD y el CRM sigue en ` +
          `${previousGrossUsd.toFixed(2)} USD. Mercado Pago no se cambió. ` +
          `Fallo al revertir: ${errText(revertError)}`;
        await prisma.product.update({
          where: { id: product.id },
          data: { priceSyncStatus: "DRIFTED", priceSyncNote: note },
        });
        await notifyDrift(product.id, product.title, note);
        return { ok: false, code: "PAYPAL_REVERT_FAILED", message: note };
      }
    }
  }

  // 3) Los proveedores dijeron que sí. Ahora, y sólo ahora, se persiste.
  const syncRows: Prisma.ProductPriceSyncCreateManyInput[] = [];
  if (touchPayPal && newGrossUsd != null && nextUsdMinor != null) {
    syncRows.push({
      productId: product.id,
      provider: PaymentProvider.PAYPAL,
      currency: "USD",
      grossMinor: Math.round(newGrossUsd * 100),
      netMinor: nextUsdMinor,
      externalPlanId: product.paypalPlanId!,
    });
  }
  if (touchMercadoPago && newGrossCop != null && nextCopMinor != null) {
    syncRows.push({
      productId: product.id,
      provider: PaymentProvider.MERCADO_PAGO,
      currency: "COP",
      grossMinor: newGrossCop,
      netMinor: nextCopMinor,
      externalPlanId: product.mercadoPagoPreapprovalPlanId!,
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (usdChanges && nextUsdMinor != null) {
      await tx.productPrice.create({
        data: {
          productId: product.id,
          currency: "USD",
          amountMinor: nextUsdMinor,
          listAmountMinor: currentUsd?.listAmountMinor ?? null,
        },
      });
    }
    if (copChanges && nextCopMinor != null) {
      await tx.productPrice.create({
        data: {
          productId: product.id,
          currency: "COP",
          amountMinor: nextCopMinor,
          listAmountMinor: currentCop?.listAmountMinor ?? null,
        },
      });
    }
    if (syncRows.length > 0) {
      await tx.productPriceSync.createMany({ data: syncRows });
    }
    return tx.product.update({
      where: { id: product.id },
      data: {
        priceSyncStatus: "SYNCED",
        priceSyncNote: null,
        priceSyncCheckedAt: new Date(),
      },
    });
  });

  void options.staffUserId; // la auditoría la escribe la ruta, con su actor

  return { ok: true, changed: true, product: updated, newGrossUsd };
};

/**
 * ¿Cuadra el CRM con lo que cobran los planes AHORA MISMO?
 *
 * Se lee el precio vivo de la API del proveedor, no la tabla de sincronismos:
 * así también salta cuando cambia `PAYPAL_FEE_PERCENT` o
 * `MERCADOPAGO_FEE_PERCENT`, que descuadra el bruto sin que nadie haya tocado
 * el precio.
 */
export const verifyProductPriceSync = async (
  productId: string
): Promise<{ inSync: boolean; details: string }> => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: productWithPrices,
  });
  if (!product) return { inSync: false, details: "Producto no encontrado." };
  if (!hasSubscriptionPlan(product)) {
    return { inSync: true, details: "Sin plan de suscripción." };
  }

  const problems: string[] = [];

  if (product.paypalPlanId) {
    const netUsd = latestMinor(product, "USD")?.amountMinor ?? null;
    if (netUsd == null) {
      problems.push("PayPal tiene plan pero el CRM no tiene precio USD.");
    } else {
      try {
        const plan = await getBillingPlan(product.paypalPlanId);
        const live = billingPlanGrossMinor(plan);
        const expected = Math.round(usdMinorToGross(netUsd) * 100);
        if (live == null) {
          problems.push("No se pudo leer el precio del plan de PayPal.");
        } else if (live !== expected) {
          problems.push(
            `PayPal cobra ${(live / 100).toFixed(2)} USD y debería cobrar ${(expected / 100).toFixed(2)} USD.`
          );
        }
      } catch (e) {
        problems.push(`No se pudo consultar el plan de PayPal: ${errText(e)}`);
      }
    }
  }

  if (product.mercadoPagoPreapprovalPlanId) {
    const netCop = latestMinor(product, "COP")?.amountMinor ?? null;
    if (netCop == null) {
      problems.push("Mercado Pago tiene plan pero el CRM no tiene precio COP.");
    } else {
      try {
        const plan = await getPreapprovalPlan(
          product.mercadoPagoPreapprovalPlanId
        );
        const live = plan.auto_recurring?.transaction_amount ?? null;
        const expected = copToGross(netCop);
        if (live == null) {
          problems.push("No se pudo leer el precio del plan de Mercado Pago.");
        } else if (Math.round(live) !== expected) {
          problems.push(
            `Mercado Pago cobra ${Math.round(live).toLocaleString("es-CO")} COP y debería cobrar ${expected.toLocaleString("es-CO")} COP.`
          );
        }
      } catch (e) {
        problems.push(
          `No se pudo consultar el plan de Mercado Pago: ${errText(e)}`
        );
      }
    }
  }

  const inSync = problems.length === 0;
  const details = inSync ? "Los planes cobran lo que dice el CRM." : problems.join(" ");
  const wasDrifted = product.priceSyncStatus === "DRIFTED";

  await prisma.product.update({
    where: { id: product.id },
    data: {
      priceSyncStatus: inSync ? "SYNCED" : "DRIFTED",
      priceSyncNote: inSync ? null : details,
      priceSyncCheckedAt: new Date(),
    },
  });

  // Sólo en la transición: si no, el cron cantaría lo mismo cada día.
  if (!inSync && !wasDrifted) {
    await notifyDrift(product.id, product.title, details);
  }

  return { inSync, details };};

const errText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

const notifyDrift = async (
  productId: string,
  title: string,
  details: string
): Promise<void> => {
  // Import diferido: este módulo lo usan también los scripts de línea de
  // comandos, y arrastrar el árbol de notificaciones ahí no aporta nada.
  const { emitPlatformNotification } = await import(
    "@/lib/notifications/platform/emit"
  );
  await emitPlatformNotification({
    eventType: "PRICE_SYNC_DRIFT",
    title: `El precio de «${title}» no cuadra con los proveedores`,
    body: details,
    href: "/admin/products",
    entityType: "Product",
    entityId: productId,
    staff: "ALL",
  }).catch(() => undefined);
};
