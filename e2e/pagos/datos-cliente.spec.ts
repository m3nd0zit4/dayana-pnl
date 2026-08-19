// Antes que nada: engancha el alias `@/` para los import() diferidos.
import "./alias";

import { test, expect } from "@playwright/test";
import {
  createCheckout,
  contactById,
  nextProviderId,
  nextPhone,
  testEmail,
  cleanupTestData,
  db,
} from "./helpers";
import { syncMercadoPagoPayment } from "../../lib/crm/mercadopago-payments";
import {
  encodeCheckoutReference,
  parseCheckoutReference,
} from "../../lib/crm/checkout-reference";

/**
 * Los datos de la clienta y la integridad de la referencia.
 *
 * Es el equivalente nuestro a dos preferencias que PayPal no nos concede o no
 * cubre: recoger el teléfono del pagador y proteger los datos del checkout de
 * manipulación.
 */

const realFetch = globalThis.fetch;

const stubMercadoPago = (byId: Record<string, Record<string, unknown>>) => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const m = url.match(/api\.mercadopago\.com\/v1\/payments\/([^/?]+)/);
    if (!m) return realFetch(input as RequestInfo, init);
    const body = byId[m[1]];
    if (!body) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
};

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test.afterAll(async () => {
  await cleanupTestData();
  await db.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe("Referencia de checkout · firma", () => {
  test("una referencia válida se acepta y una manipulada se rechaza", () => {
    const ref = encodeCheckoutReference("cabc123", "therapy-1", {
      code: "VERANO",
      discountMinor: 5000,
    });

    const ok = parseCheckoutReference(ref);
    expect(ok?.signed).toBe(true);
    expect(ok?.discountMinor).toBe(5000);

    // Subir el descuento sin recalcular la firma: es exactamente el abuso que
    // la firma existe para frenar.
    const forjada = ref.replace(":5000:", ":500000:");
    expect(
      parseCheckoutReference(forjada),
      "se aceptó una referencia con el descuento manipulado"
    ).toBeNull();
  });

  test("una referencia antigua sin firma se sigue aceptando", () => {
    // Órdenes en vuelo durante el despliegue: rechazarlas sería cobrar y no
    // registrar la compra.
    const vieja = parseCheckoutReference("chk:cabc123:therapy-1");
    expect(vieja?.contactId).toBe("cabc123");
    expect(vieja?.signed).toBe(false);
  });

  test("cabe en el custom_id de PayPal aun con promo larga", () => {
    const ref = encodeCheckoutReference(
      "cmt0624nf0001i5xkilp3h1pc",
      "workshop-virtual",
      { code: "PROMOCION-NAVIDAD-2026", discountMinor: 1234567 }
    );
    // PayPal recorta `custom_id` a 127; si se recorta, la firma muere y el
    // pago dejaría de reconocerse.
    expect(ref.length).toBeLessThanOrEqual(127);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe("Datos del pagador · Mercado Pago", () => {
  test("el teléfono y el país del pagador llegan al contacto", async ({
    baseURL,
  }) => {
    const chk = await createCheckout(baseURL!, "mercadopago", "therapy-1");
    const mpId = nextProviderId("MP").replace(/\D/g, "");
    const email = testEmail("con.telefono");

    stubMercadoPago({
      [mpId]: {
        id: Number(mpId),
        status: "approved",
        currency_id: "COP",
        transaction_amount: 480000,
        external_reference: chk.checkoutReference,
        payer: {
          email,
          first_name: "Marcela",
          last_name: "Ruiz",
          phone: { area_code: "300", number: "1234567" },
          address: { country: "CO" },
        },
      },
    });

    const r = await syncMercadoPagoPayment(mpId);
    expect(r.outcome, JSON.stringify(r)).toBe("recorded");

    const pago = await db.payment.findFirstOrThrow({
      where: { providerPaymentId: mpId },
      include: { enrollment: { include: { contact: true } } },
    });
    const contacto = pago.enrollment.contact;

    expect(
      contacto.phoneE164,
      "el teléfono del pagador se perdió; el contacto sigue temporal"
    ).toBe("+573001234567");
    expect(contacto.phoneCountryIso).toBe("CO");
    expect(contacto.countryIso).toBe("CO");
    expect(contacto.firstName).toBe("Marcela");
  });

  test("si ese teléfono ya tiene ficha, se matricula en ESA", async ({
    baseURL,
  }) => {
    const phone = nextPhone();
    // El payer de MP manda prefijo y número por separado: se parte el E.164.
    const areaCode = phone.slice(3, 6);
    const localNumber = phone.slice(6);
    const existente = await db.contact.create({
      data: {
        phoneE164: phone,
        firstName: "Ficha",
        lastName: "Previa",
        email: testEmail("tel.colision"),
      },
    });

    const chk = await createCheckout(baseURL!, "mercadopago", "therapy-3");
    const mpId = nextProviderId("MP").replace(/\D/g, "");

    stubMercadoPago({
      [mpId]: {
        id: Number(mpId),
        status: "approved",
        currency_id: "COP",
        transaction_amount: 480000,
        external_reference: chk.checkoutReference,
        // Sin email: la colisión tiene que resolverse SÓLO por teléfono.
        payer: {
          first_name: "Ficha",
          phone: { area_code: areaCode, number: localNumber },
        },
      },
    });

    await syncMercadoPagoPayment(mpId);

    const pago = await db.payment.findFirstOrThrow({
      where: { providerPaymentId: mpId },
      include: { enrollment: true },
    });
    expect(
      pago.enrollment.contactId,
      "se creó una segunda ficha con el mismo teléfono (phoneE164 es @unique)"
    ).toBe(existente.id);

    expect(await contactById(chk.contactId!)).toBeNull();
  });

  test("un teléfono ilegible no rompe el pago", async ({ baseURL }) => {
    const chk = await createCheckout(baseURL!, "mercadopago", "therapy-6");
    const mpId = nextProviderId("MP").replace(/\D/g, "");

    stubMercadoPago({
      [mpId]: {
        id: Number(mpId),
        status: "approved",
        currency_id: "COP",
        transaction_amount: 480000,
        external_reference: chk.checkoutReference,
        payer: {
          email: testEmail("tel.basura"),
          phone: { area_code: "0", number: "12" },
        },
      },
    });

    const r = await syncMercadoPagoPayment(mpId);
    expect(r.outcome, "un teléfono basura tumbó el registro del pago").toBe(
      "recorded"
    );

    const pago = await db.payment.findFirstOrThrow({
      where: { providerPaymentId: mpId },
      include: { enrollment: { include: { contact: true } } },
    });
    // Se descarta el número inválido y el contacto sigue temporal, que es lo
    // que dispara el aviso de "falta el teléfono".
    expect(pago.enrollment.contact.phoneE164).toMatch(/^\+pending:/);
  });
});
