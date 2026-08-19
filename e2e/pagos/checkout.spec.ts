import { test, expect } from "@playwright/test";
import {
  createCheckout,
  contactById,
  cleanupTestData,
  db,
} from "./helpers";

/**
 * Creación de checkout para todo el catálogo, en los dos proveedores.
 *
 * Crear una orden en PayPal o una preferencia en Mercado Pago NO cobra nada:
 * son objetos sin aprobar. Por eso este bloque puede correr contra las
 * credenciales reales sin mover dinero.
 */

const PLANS = [
  "therapy-1",
  "therapy-3",
  "therapy-6",
  "therapy-12",
  "therapy-24",
  "workshop-virtual",
  "course-live",
] as const;

test.afterAll(async () => {
  await cleanupTestData();
  await db.$disconnect();
});

test.describe("Checkout · creación", () => {
  for (const planId of PLANS) {
    test(`PayPal crea orden para ${planId} sin pedir datos`, async ({
      baseURL,
    }) => {
      const r = await createCheckout(baseURL!, "paypal", planId);

      expect(r.status, `respuesta: ${JSON.stringify(r)}`).toBe(200);
      // El flujo por redirección depende de este enlace; sin él el botón no
      // tiene a dónde ir.
      expect(r.approveUrl, "falta approveUrl (flujo por redirección)").toContain(
        "paypal.com"
      );
      // La referencia va firmada (HMAC recortado al final): el contacto y el
      // plan siguen en claro, con la firma como último segmento.
      expect(r.checkoutReference).toMatch(
        new RegExp(`^chk:[a-z0-9]+:${planId}:[A-Za-z0-9_-]{16}$`)
      );

      // Sin formulario previo debe quedar un contacto temporal.
      const contact = await contactById(r.contactId!);
      expect(contact?.phoneE164).toMatch(/^\+pending:/);
    });
  }

  for (const planId of PLANS) {
    test(`Mercado Pago crea preferencia para ${planId} sin pedir datos`, async ({
      baseURL,
    }) => {
      const r = await createCheckout(baseURL!, "mercadopago", planId);

      // `workshop-virtual` no tiene fila COP: debe fallar limpio con
      // `no_cop_price`, no con un 500 ni cobrando una cifra inventada.
      const plan = await db.product.findUnique({
        where: { id: planId },
        select: { prices: { where: { currency: "COP" }, take: 1 } },
      });
      const hasCop = (plan?.prices.length ?? 0) > 0;

      if (!hasCop) {
        expect(r.status).toBe(400);
        expect(r.error).toBe("no_cop_price");
        return;
      }

      expect(r.status, `respuesta: ${JSON.stringify(r)}`).toBe(200);
      expect(r.init_point).toContain("mercadopago");
      const contact = await contactById(r.contactId!);
      expect(contact?.phoneE164).toMatch(/^\+pending:/);
    });
  }
});

test.describe("Checkout · validaciones", () => {
  test("plan inexistente se rechaza", async ({ baseURL }) => {
    const r = await createCheckout(baseURL!, "paypal", "no-existe");
    expect(r.status).toBe(400);
    expect(r.error).toBe("invalid_plan");
  });

  test("promo inválido se rechaza y no crea orden", async ({ baseURL }) => {
    const r = await createCheckout(baseURL!, "paypal", "therapy-1", {
      promoCode: "NOEXISTE2026",
    });
    expect(r.status).toBe(400);
    expect(r.error).toBe("invalid_promo_code");
  });
});

test.describe("Checkout · precios y comisión", () => {
  test("el importe de PayPal lleva el gross-up sobre el neto", async ({
    baseURL,
    request,
  }) => {
    const quoteRes = await request.post("/api/payments/quote", {
      data: { planId: "therapy-1", provider: "paypal" },
    });
    const quote = (await quoteRes.json()) as {
      subtotal: string;
      fee: string;
      total: string;
    };

    // subtotal + comisión = total, sin céntimos perdidos por redondeo.
    expect(Number(quote.subtotal) + Number(quote.fee)).toBeCloseTo(
      Number(quote.total),
      2
    );

    const order = await createCheckout(baseURL!, "paypal", "therapy-1");
    expect(order.amountValue).toBe(quote.total);
  });

  test("Mercado Pago cotiza en COP con el precio explícito del CRM", async ({
    request,
  }) => {
    const res = await request.post("/api/payments/quote", {
      data: { planId: "therapy-1", provider: "mercadopago" },
    });
    const quote = (await res.json()) as {
      currency: string;
      subtotal: string;
      fee: string;
      total: string;
    };
    expect(quote.currency).toBe("COP");
    // Nunca convertido desde USD: debe ser la fila COP tal cual.
    const cop = await db.productPrice.findFirst({
      where: { productId: "therapy-1", currency: "COP" },
      orderBy: { validFrom: "desc" },
    });
    expect(Number(quote.subtotal)).toBe(cop?.amountMinor);
  });
});

test.describe("Región · qué se le muestra a cada país", () => {
  const cases = [
    { country: "CO", expect: "MercadoPago" },
    { country: "US", expect: "PayPal" },
    { country: "MX", expect: "PayPal" },
    { country: "ES", expect: "PayPal" },
    { country: "AR", expect: "PayPal" },
  ];

  for (const c of cases) {
    test(`${c.country} ve ${c.expect}`, async ({ request }) => {
      const res = await request.get("/servicios", {
        headers: { "x-country-code": c.country },
      });
      const html = await res.text();
      expect(html).toContain(c.expect);
    });
  }

  test("un taller sin precio COP no muestra botón de pago en Colombia", async ({
    request,
  }) => {
    // `isPlanVisibleForRegion` debe ocultarlo. Si se muestra, la visitante
    // llega al checkout y revienta con `no_cop_price`.
    const res = await request.get("/taller", {
      headers: { "x-country-code": "CO" },
    });
    if (res.status() === 404) test.skip(true, "no hay página /taller");
    const html = await res.text();
    const cop = await db.productPrice.findFirst({
      where: { productId: "workshop-virtual", currency: "COP" },
    });
    if (!cop) {
      expect(html).not.toContain("MercadoPago");
    }
  });
});
