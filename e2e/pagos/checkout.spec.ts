import { test, expect } from "@playwright/test";
import {
  createCheckout,
  contactById,
  cleanupTestData,
  db,
} from "./helpers";
import { getPricingRegion } from "@/lib/pricing/regions";

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

/**
 * Estas cinco pruebas pedían `/servicios` y buscaban «PayPal» o «MercadoPago»
 * en el HTML. Esa página **se retiró** en agosto —el catálogo de precios de
 * terapia dejó de existir: ahora se cualifica antes de cotizar— así que
 * llevaban desde entonces fallando por 404, no por un fallo real.
 *
 * Y no se pueden reapuntar a otra página: el nombre de la pasarela sólo
 * aparece cuando se abre el modal de pago, que es cliente. Ninguna página
 * pública lo trae en el HTML servido; comprobado contra `/` y `/cursos`.
 *
 * Así que se comprueba la regla donde vive, igual que hacen las pruebas de
 * estados de Mercado Pago con `lib/crm/*` (ver la cabecera de
 * `playwright.payments.config.ts`). Lo que importaba fijar era el reparto, y
 * ese sigue fijado: **Colombia por Mercado Pago en COP, el resto por PayPal en
 * USD.**
 */
test.describe("Región · qué riel le toca a cada país", () => {
  const cases = [
    { country: "CO", provider: "MERCADO_PAGO", currency: "COP" },
    { country: "US", provider: "PAYPAL", currency: "USD" },
    { country: "MX", provider: "PAYPAL", currency: "USD" },
    { country: "ES", provider: "PAYPAL", currency: "USD" },
    { country: "AR", provider: "PAYPAL", currency: "USD" },
  ] as const;

  for (const c of cases) {
    test(`${c.country} va por ${c.provider}`, () => {
      const region = getPricingRegion(c.country);
      expect(region.provider).toBe(c.provider);
      expect(region.currency).toBe(c.currency);
    });
  }

  test("un país desconocido cae en el riel internacional, no en ninguno", () => {
    // Sin país resuelto —cabecera ausente, o un ISO que no conocemos— la
    // compradora tiene que poder pagar igual. Quedarse sin riel sería una
    // pantalla sin botón.
    for (const country of [null, "XX", "JP"]) {
      const region = getPricingRegion(country);
      expect(region.provider).toBe("PAYPAL");
      expect(region.currency).toBe("USD");
    }
  });

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
