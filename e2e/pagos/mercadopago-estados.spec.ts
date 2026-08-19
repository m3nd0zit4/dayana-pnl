// Antes que nada: engancha el alias `@/` para los import() diferidos.
import "./alias";

import { test, expect } from "@playwright/test";
import { PaymentStatus } from "@prisma/client";
import {
  createCheckout,
  contactById,
  nextProviderId,
  testEmail,
  cleanupTestData,
  db,
} from "./helpers";
import { syncMercadoPagoPayment } from "../../lib/crm/mercadopago-payments";
import { abandonStalePlaceholderCheckouts } from "../../lib/crm/checkout-placeholder";

/**
 * Estados de Mercado Pago.
 *
 * El webhook de MP sólo trae un id: el estado se LEE de su API. Por eso estas
 * pruebas no pueden ir por HTTP como las de PayPal — falsean la respuesta de
 * `api.mercadopago.com` y llaman a `syncMercadoPagoPayment` directamente, que
 * es exactamente lo que el webhook y `/pago/exito` invocan.
 */

const realFetch = globalThis.fetch;

/** Deja que `api.mercadopago.com/v1/payments/<id>` conteste lo que le digamos. */
const stubMercadoPago = (
  byId: Record<string, Record<string, unknown> | undefined>
) => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = url.match(/api\.mercadopago\.com\/v1\/payments\/([^/?]+)/);
    if (!match) return realFetch(input as RequestInfo, init);
    const body = byId[match[1]];
    if (!body) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
};

const mpPayment = (over: Record<string, unknown>) => ({
  currency_id: "COP",
  transaction_amount: 480000,
  ...over,
});

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test.afterAll(async () => {
  await cleanupTestData();
  await db.$disconnect();
});

test.describe("Mercado Pago · estados del pago", () => {
  test("un PSE pendiente queda registrado y se activa al aprobarse", async ({
    baseURL,
  }) => {
    const chk = await createCheckout(baseURL!, "mercadopago", "therapy-1");
    const mpId = nextProviderId("MP").replace(/\D/g, "");
    const email = testEmail("pse.pendiente");

    // 1er aviso: PSE aceptado por el banco, dinero todavía en camino.
    stubMercadoPago({
      [mpId]: mpPayment({
        id: Number(mpId),
        status: "pending",
        external_reference: chk.checkoutReference,
        payer: { email, first_name: "Lucía", last_name: "Marín" },
      }),
    });
    const first = await syncMercadoPagoPayment(mpId);
    expect(first.outcome, JSON.stringify(first)).toBe("recorded");

    const pendiente = await db.payment.findFirst({
      where: { providerPaymentId: mpId },
      include: { enrollment: true },
    });
    expect(
      pendiente,
      "un pago PSE en curso no dejó rastro en el CRM"
    ).toBeTruthy();
    expect(pendiente!.status).toBe(PaymentStatus.PENDING);
    // Sin acceso: el dinero aún no llegó.
    expect(pendiente!.enrollment.status).toBe("PENDING_PAYMENT");

    // El contacto ya no es anónimo aunque falte la aprobación.
    const contacto = await contactById(pendiente!.enrollment.contactId);
    expect(contacto?.email, "el contacto sigue siendo un +pending anónimo").toBe(
      email
    );
    expect(contacto?.firstName).toBe("Lucía");

    // 2º aviso: acreditado.
    stubMercadoPago({
      [mpId]: mpPayment({
        id: Number(mpId),
        status: "approved",
        external_reference: chk.checkoutReference,
        payer: { email, first_name: "Lucía", last_name: "Marín" },
      }),
    });
    const second = await syncMercadoPagoPayment(mpId);
    expect(second.outcome).toBe("recorded");

    const filas = await db.payment.findMany({
      where: { providerPaymentId: mpId },
      include: { enrollment: true },
    });
    expect(filas, "la aprobación duplicó el pago").toHaveLength(1);
    expect(
      filas[0].status,
      "el pago se quedó congelado en pendiente con el dinero ya cobrado"
    ).toBe(PaymentStatus.APPROVED);
    expect(filas[0].enrollment.status).toBe("ACTIVE");
  });

  test("un pago rechazado se registra como FAILED", async ({ baseURL }) => {
    const chk = await createCheckout(baseURL!, "mercadopago", "therapy-3");
    const mpId = nextProviderId("MP").replace(/\D/g, "");

    stubMercadoPago({
      [mpId]: mpPayment({
        id: Number(mpId),
        status: "rejected",
        external_reference: chk.checkoutReference,
        payer: { email: testEmail("rechazado") },
      }),
    });
    const r = await syncMercadoPagoPayment(mpId);
    expect(r.outcome, JSON.stringify(r)).toBe("recorded");

    const pago = await db.payment.findFirst({
      where: { providerPaymentId: mpId },
    });
    expect(pago?.status).toBe(PaymentStatus.FAILED);
  });

  test("la barrida de checkouts abandonados no borra un pago en curso", async ({
    baseURL,
  }) => {
    const chk = await createCheckout(baseURL!, "mercadopago", "therapy-6");
    const mpId = nextProviderId("MP").replace(/\D/g, "");

    stubMercadoPago({
      [mpId]: mpPayment({
        id: Number(mpId),
        status: "pending",
        external_reference: chk.checkoutReference,
        payer: { email: testEmail("efectivo.lento") },
      }),
    });
    await syncMercadoPagoPayment(mpId);

    const pago = await db.payment.findFirstOrThrow({
      where: { providerPaymentId: mpId },
    });

    // Un pago en efectivo tarda días: se envejece la matrícula más allá del
    // corte de 24 h para que la barrida la considere.
    await db.enrollment.update({
      where: { id: pago.enrollmentId },
      data: { createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000) },
    });

    await abandonStalePlaceholderCheckouts();

    expect(
      await db.payment.findUnique({ where: { id: pago.id } }),
      "la limpieza nocturna borró un pago que todavía estaba en curso"
    ).toBeTruthy();
  });
});
