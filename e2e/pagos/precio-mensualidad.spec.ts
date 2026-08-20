// Antes que nada: engancha el alias `@/` para los import() diferidos.
import "./alias";

import { test, expect } from "@playwright/test";
import { PaymentProvider } from "@prisma/client";
import { db } from "./helpers";
import {
  changeSubscriptionPrice,
  verifyProductPriceSync,
} from "../../lib/pricing/price-sync";
import { verifySubscriptionChargeAmount } from "../../lib/crm/subscription-payment-validation";
import { validatePromoCode, hasUsablePromoCode } from "../../lib/crm/promo-codes";
import { updateProduct } from "../../lib/crm/products-admin";
import { grossUpInt, grossUpUsd, mercadoPagoFee, paypalFee } from "../../lib/pricing/fees";

/**
 * El precio de la mensualidad no puede desincronizarse de lo que cobran los
 * planes. Aquí se demuestra por el lado que importa: **cuando un proveedor
 * falla, el precio NO se guarda**, así que la web nunca anuncia algo que nadie
 * cobra.
 *
 * Se falsean las APIs de PayPal y Mercado Pago por substring de URL —igual que
 * `suscripcion-mp.spec.ts`— porque lo que se prueba es nuestra máquina de
 * estados, no la de ellos. Un plan de verdad no se puede borrar, así que
 * tampoco sería sensato crear uno por corrida.
 */

const PRODUCTO = "e2e-precio-mensualidad";
const PLAN_PAYPAL = "P-E2ETESTPLAN0000000000000";
const PLAN_MP = "e2e-mp-plan-precio";

const realFetch = globalThis.fetch;

type Ruta = { status?: number; body?: unknown; fail?: boolean };

/** Llamadas que han pasado por el stub, para poder afirmar sobre ellas. */
let llamadas: { url: string; method: string; body?: unknown }[] = [];

const safeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const stub = (rutas: Record<string, Ruta>) => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const hit = Object.keys(rutas).find((k) => url.includes(k));
    if (!hit) return realFetch(input as RequestInfo, init);

    llamadas.push({
      url,
      method: init?.method ?? "GET",
      // El cuerpo del token OAuth es `grant_type=…`, no JSON.
      body: init?.body ? safeJson(String(init.body)) : undefined,
    });

    const ruta = rutas[hit];
    if (ruta.fail) {
      return new Response(JSON.stringify({ message: "proveedor caído" }), {
        status: ruta.status ?? 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const status = ruta.status ?? 200;
    // 204 es lo que responde `update-pricing-schemes`, y un 204 no admite
    // cuerpo: construir un Response con ambos lanza.
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(ruta.body ?? {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
};

/** Token OAuth: siempre concedido, no es lo que se prueba. */
const OAUTH = { "/v1/oauth2/token": { body: { access_token: "e2e-token" } } };

const NETO_USD_INICIAL = 3500; // 35.00 USD
const NETO_COP_INICIAL = 120_000;

const crearProducto = async () => {
  await db.product.create({
    data: {
      id: PRODUCTO,
      kind: "COURSE",
      title: "Mensualidad de prueba",
      sessionsLabel: "Mensualidad",
      isActive: false, // fuera del catálogo público
      paypalPlanId: PLAN_PAYPAL,
      mercadoPagoPreapprovalPlanId: PLAN_MP,
      prices: {
        create: [
          { currency: "USD", amountMinor: NETO_USD_INICIAL },
          { currency: "COP", amountMinor: NETO_COP_INICIAL },
        ],
      },
    },
  });
};

const limpiar = async () => {
  await db.product.deleteMany({ where: { id: PRODUCTO } });
};

const precioActual = async (currency: "USD" | "COP") => {
  const row = await db.productPrice.findFirst({
    where: { productId: PRODUCTO, currency },
    orderBy: { validFrom: "desc" },
  });
  return row?.amountMinor ?? null;
};

test.beforeEach(async () => {
  llamadas = [];
  await limpiar();
  await crearProducto();
});

test.afterEach(async () => {
  globalThis.fetch = realFetch;
  await limpiar();
});

test.describe("Precio de la mensualidad · el invariante", () => {
  test("con los dos proveedores conformes, se guarda el precio y queda rastro", async () => {
    stub({
      ...OAUTH,
      "/v1/billing/plans/": { status: 204 },
      "/preapproval_plan/": { body: { id: PLAN_MP } },
    });

    const res = await changeSubscriptionPrice(PRODUCTO, {
      amountUsd: 40,
      amountCop: 150_000,
    });

    expect(res.ok).toBe(true);
    expect(await precioActual("USD")).toBe(4000);
    expect(await precioActual("COP")).toBe(150_000);

    const syncs = await db.productPriceSync.findMany({
      where: { productId: PRODUCTO },
    });
    expect(syncs).toHaveLength(2);

    // El testigo guarda el BRUTO, que es lo que cobra el plan — no el neto.
    const paypal = syncs.find((s) => s.provider === PaymentProvider.PAYPAL)!;
    expect(paypal.grossMinor).toBe(
      Math.round(grossUpUsd(40, paypalFee()).gross * 100)
    );
    expect(paypal.netMinor).toBe(4000);

    const mp = syncs.find((s) => s.provider === PaymentProvider.MERCADO_PAGO)!;
    expect(mp.grossMinor).toBe(grossUpInt(150_000, mercadoPagoFee()).gross);

    const producto = await db.product.findUnique({ where: { id: PRODUCTO } });
    expect(producto?.priceSyncStatus).toBe("SYNCED");
  });

  test("si PayPal falla no se guarda nada, y a Mercado Pago ni se le llama", async () => {
    stub({
      ...OAUTH,
      "/v1/billing/plans/": { fail: true, status: 422 },
      "/preapproval_plan/": { body: { id: PLAN_MP } },
    });

    const res = await changeSubscriptionPrice(PRODUCTO, {
      amountUsd: 40,
      amountCop: 150_000,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PAYPAL_FAILED");

    // Lo que de verdad importa: la web sigue anunciando el precio viejo.
    expect(await precioActual("USD")).toBe(NETO_USD_INICIAL);
    expect(await precioActual("COP")).toBe(NETO_COP_INICIAL);
    expect(await db.productPriceSync.count({ where: { productId: PRODUCTO } })).toBe(0);

    expect(llamadas.some((l) => l.url.includes("/preapproval_plan/"))).toBe(false);
  });

  test("si Mercado Pago falla, se deshace PayPal y tampoco se guarda nada", async () => {
    stub({
      ...OAUTH,
      "/v1/billing/plans/": { status: 204 },
      "/preapproval_plan/": { fail: true },
    });

    const res = await changeSubscriptionPrice(PRODUCTO, {
      amountUsd: 40,
      amountCop: 150_000,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("MERCADOPAGO_FAILED");

    expect(await precioActual("USD")).toBe(NETO_USD_INICIAL);
    expect(await db.productPriceSync.count({ where: { productId: PRODUCTO } })).toBe(0);

    // Dos llamadas a PayPal: el importe nuevo y la vuelta al viejo.
    const aPayPal = llamadas.filter((l) =>
      l.url.includes("/update-pricing-schemes")
    );
    expect(aPayPal).toHaveLength(2);

    const valor = (i: number) =>
      (aPayPal[i].body as { pricing_schemes: { pricing_scheme: { fixed_price: { value: string } } }[] })
        .pricing_schemes[0].pricing_scheme.fixed_price.value;
    expect(valor(0)).toBe(grossUpUsd(40, paypalFee()).gross.toFixed(2));
    expect(valor(1)).toBe(
      grossUpUsd(NETO_USD_INICIAL / 100, paypalFee()).gross.toFixed(2)
    );

    const producto = await db.product.findUnique({ where: { id: PRODUCTO } });
    expect(producto?.priceSyncStatus).toBe("SYNCED");
  });

  test("si tampoco se puede deshacer PayPal, queda marcado y AUN ASÍ no se guarda el precio", async () => {
    let intentos = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "e2e" }), { status: 200 });
      }
      if (url.includes("/update-pricing-schemes")) {
        intentos += 1;
        // El primero pasa (PayPal ya cobra lo nuevo); la reversión falla.
        return intentos === 1
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify({ message: "no" }), { status: 500 });
      }
      if (url.includes("/preapproval_plan/")) {
        return new Response(JSON.stringify({ message: "no" }), { status: 500 });
      }
      return realFetch(input as RequestInfo, init);
    }) as typeof fetch;

    const res = await changeSubscriptionPrice(PRODUCTO, {
      amountUsd: 40,
      amountCop: 150_000,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PAYPAL_REVERT_FAILED");

    // PayPal cobra de más, pero la web NO anuncia de más: se prefiere quedarse
    // corto antes que prometer un precio que nadie cobra.
    expect(await precioActual("USD")).toBe(NETO_USD_INICIAL);

    const producto = await db.product.findUnique({ where: { id: PRODUCTO } });
    expect(producto?.priceSyncStatus).toBe("DRIFTED");
    expect(producto?.priceSyncNote ?? "").not.toBe("");
  });

  test("estando descuadrado, se rehúsan más cambios de precio", async () => {
    await db.product.update({
      where: { id: PRODUCTO },
      data: { priceSyncStatus: "DRIFTED", priceSyncNote: "desfase de prueba" },
    });
    stub({ ...OAUTH, "/v1/billing/plans/": { status: 204 } });

    const res = await changeSubscriptionPrice(PRODUCTO, { amountUsd: 41 });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PRODUCT_DRIFTED");
    expect(await precioActual("USD")).toBe(NETO_USD_INICIAL);
  });

  test("sin cambio de importe no se molesta a los proveedores", async () => {
    stub({ ...OAUTH, "/v1/billing/plans/": { status: 204 } });

    const res = await changeSubscriptionPrice(PRODUCTO, {
      amountUsd: NETO_USD_INICIAL / 100,
      amountCop: NETO_COP_INICIAL,
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.changed).toBe(false);
    // Mandar el mismo importe a PayPal devuelve 422; por eso ni se intenta.
    expect(llamadas.some((l) => l.url.includes("/update-pricing-schemes"))).toBe(false);
  });

  test("nadie puede escribir el precio por la puerta de atrás", async () => {
    await expect(updateProduct(PRODUCTO, { amountUsd: 99 })).rejects.toThrow(
      "USE_CHANGE_SUBSCRIPTION_PRICE"
    );
    expect(await precioActual("USD")).toBe(NETO_USD_INICIAL);
  });
});

test.describe("Precio de la mensualidad · vigilancia", () => {
  test("el cron detecta el desfase que provoca cambiar la comisión", async () => {
    const brutoConComisionVigente = grossUpUsd(
      NETO_USD_INICIAL / 100,
      paypalFee()
    ).gross;

    // El plan sigue cobrando lo de antes mientras la comisión subió: nadie tocó
    // el precio y aun así ya no cuadra.
    stub({
      ...OAUTH,
      [`/v1/billing/plans/${PLAN_PAYPAL}`]: {
        body: {
          id: PLAN_PAYPAL,
          billing_cycles: [
            {
              tenure_type: "REGULAR",
              sequence: 1,
              pricing_scheme: {
                fixed_price: {
                  value: (brutoConComisionVigente - 3).toFixed(2),
                  currency_code: "USD",
                },
              },
            },
          ],
        },
      },
      [`/preapproval_plan/${PLAN_MP}`]: {
        body: {
          id: PLAN_MP,
          auto_recurring: {
            transaction_amount: grossUpInt(NETO_COP_INICIAL, mercadoPagoFee()).gross,
          },
        },
      },
    });

    const res = await verifyProductPriceSync(PRODUCTO);

    expect(res.inSync).toBe(false);
    expect(res.details).toContain("PayPal cobra");

    const producto = await db.product.findUnique({ where: { id: PRODUCTO } });
    expect(producto?.priceSyncStatus).toBe("DRIFTED");
    expect(producto?.priceSyncCheckedAt).not.toBeNull();
  });

  test("cuando todo cuadra, el producto vuelve a SYNCED", async () => {
    await db.product.update({
      where: { id: PRODUCTO },
      data: { priceSyncStatus: "DRIFTED", priceSyncNote: "viejo desfase" },
    });

    stub({
      ...OAUTH,
      [`/v1/billing/plans/${PLAN_PAYPAL}`]: {
        body: {
          id: PLAN_PAYPAL,
          billing_cycles: [
            {
              tenure_type: "REGULAR",
              sequence: 1,
              pricing_scheme: {
                fixed_price: {
                  value: grossUpUsd(NETO_USD_INICIAL / 100, paypalFee()).gross.toFixed(2),
                  currency_code: "USD",
                },
              },
            },
          ],
        },
      },
      [`/preapproval_plan/${PLAN_MP}`]: {
        body: {
          id: PLAN_MP,
          auto_recurring: {
            transaction_amount: grossUpInt(NETO_COP_INICIAL, mercadoPagoFee()).gross,
          },
        },
      },
    });

    const res = await verifyProductPriceSync(PRODUCTO);

    expect(res.inSync).toBe(true);
    const producto = await db.product.findUnique({ where: { id: PRODUCTO } });
    expect(producto?.priceSyncStatus).toBe("SYNCED");
    expect(producto?.priceSyncNote).toBeNull();
  });
});

test.describe("Precio de la mensualidad · el cobro que llega", () => {
  const sembrarSync = async (grossMinor: number, appliedAt: Date) =>
    db.productPriceSync.create({
      data: {
        productId: PRODUCTO,
        provider: PaymentProvider.PAYPAL,
        currency: "USD",
        grossMinor,
        netMinor: NETO_USD_INICIAL,
        externalPlanId: PLAN_PAYPAL,
        appliedAt,
      },
    });

  test("un cobro por el importe vigente pasa sin ruido", async () => {
    await sembrarSync(4200, new Date());
    const res = await verifySubscriptionChargeAmount({
      productId: PRODUCTO,
      provider: PaymentProvider.PAYPAL,
      amountMinor: 4200,
      currency: "USD",
    });
    expect(res.ok).toBe(true);
  });

  test("un cobro con el precio anterior dentro de los 10 días de PayPal es correcto", async () => {
    const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await sembrarSync(3900, new Date(Date.now() - 40 * 24 * 60 * 60 * 1000));
    await sembrarSync(4200, ayer);

    const res = await verifySubscriptionChargeAmount({
      productId: PRODUCTO,
      provider: PaymentProvider.PAYPAL,
      amountMinor: 3900,
      currency: "USD",
      paidAt: new Date(),
    });

    expect(res.ok).toBe(true);
    expect(res.reason).toBe("matches_previous");
  });

  test("el mismo cobro pasada la ventana sí es una anomalía", async () => {
    await sembrarSync(3900, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
    await sembrarSync(4200, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

    const res = await verifySubscriptionChargeAmount({
      productId: PRODUCTO,
      provider: PaymentProvider.PAYPAL,
      amountMinor: 3900,
      currency: "USD",
      paidAt: new Date(),
    });

    expect(res.ok).toBe(false);
    expect(res.expectedMinor).toBe(4200);
  });

  test("sin historial no se inventa una anomalía", async () => {
    const res = await verifySubscriptionChargeAmount({
      productId: PRODUCTO,
      provider: PaymentProvider.PAYPAL,
      amountMinor: 12345,
      currency: "USD",
    });
    expect(res.ok).toBe(true);
    expect(res.reason).toBe("no_reference");
  });
});

test.describe("Promos · el curso queda fuera", () => {
  test("el curso rechaza cualquier código, y ni siquiera enseña el campo", async () => {
    expect(await hasUsablePromoCode("course-live")).toBe(false);

    const res = await validatePromoCode("LOQUESEA", "USD", 4000, "course-live");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("product_not_eligible");
  });

  test("en el resto del catálogo el promo sigue vivo", async () => {
    const code = `E2EPROMO${Date.now().toString().slice(-6)}`;
    const promo = await db.promoCode.create({
      data: { code, discountType: "PERCENT", percentOff: 10, isActive: true },
    });
    try {
      const res = await validatePromoCode(code, "USD", 10_000, "therapy-6");
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.discountMinor).toBe(1000);
    } finally {
      await db.promoCode.delete({ where: { id: promo.id } });
    }
  });
});
