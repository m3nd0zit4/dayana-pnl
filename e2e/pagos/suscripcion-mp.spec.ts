// Antes que nada: engancha el alias `@/` para los import() diferidos.
import "./alias";

import { test, expect } from "@playwright/test";
import { SubscriptionStatus } from "@prisma/client";
import { nextProviderId, testEmail, cleanupTestData, db } from "./helpers";
import { encodeCheckoutReference } from "../../lib/crm/checkout-reference";
import {
  syncAuthorizedPayment,
  syncPreapproval,
} from "../../lib/crm/mercadopago-subscriptions";

/**
 * Suscripción recurrente de Mercado Pago.
 *
 * Como en los pagos sueltos, el estado se lee de la API de MP y no del cuerpo
 * del webhook, así que se falsea `api.mercadopago.com` y se llama a la capa que
 * el webhook invoca.
 */

const MEMBRESIA = "course-live";
const realFetch = globalThis.fetch;

const stubMp = (rutas: Record<string, unknown>) => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const hit = Object.keys(rutas).find((k) => url.includes(k));
    if (!hit) return realFetch(input as RequestInfo, init);
    return new Response(JSON.stringify(rutas[hit]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
};

const nuevoCheckout = async (slug: string) => {
  const contact = await db.contact.create({
    data: {
      phoneE164: `+pending:${crypto.randomUUID()}`,
      firstName: "Pendiente",
      sourceDetail: `checkout:${MEMBRESIA}`,
    },
    select: { id: true },
  });
  return {
    contactId: contact.id,
    reference: encodeCheckoutReference(contact.id, MEMBRESIA),
    email: testEmail(slug),
  };
};

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test.afterAll(async () => {
  await cleanupTestData();
  await db.$disconnect();
});

test.describe("Suscripción · Mercado Pago", () => {
  test("el primer cobro crea la matrícula, la enlaza y da un mes", async () => {
    const chk = await nuevoCheckout("mpsub.primera");
    const preId = nextProviderId("PRE");
    const authId = nextProviderId("AUTH");

    stubMp({
      [`/authorized_payments/${authId}`]: {
        id: authId,
        preapproval_id: preId,
        status: "processed",
        transaction_amount: 480000,
        currency_id: "COP",
      },
      [`/preapproval/${preId}`]: {
        id: preId,
        status: "authorized",
        external_reference: chk.reference,
        payer_email: chk.email,
      },
    });

    const r = await syncAuthorizedPayment(authId);
    expect(r.outcome, JSON.stringify(r)).toBe("recorded");

    const enrollment = await db.enrollment.findFirstOrThrow({
      where: { contactId: chk.contactId, productId: MEMBRESIA },
      include: { payments: true, contact: true },
    });

    expect(
      enrollment.mercadoPagoPreapprovalId,
      "sin el id de suscripción las renovaciones no encontrarían la matrícula"
    ).toBe(preId);
    expect(enrollment.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
    expect(enrollment.subscriptionProvider).toBe("MERCADO_PAGO");
    expect(enrollment.status).toBe("ACTIVE");
    expect(enrollment.paidUntil, "el primer cobro no abrió acceso").toBeTruthy();
    // Namespaceado para no chocar con un pago suelto de MP.
    expect(enrollment.payments[0].providerPaymentId).toBe(`preapproval:${authId}`);
    // COP va en pesos enteros, sin centavos.
    expect(enrollment.payments[0].amountMinor).toBe(480000);
    expect(enrollment.contact.email).toBe(chk.email);
  });

  test("la renovación suma un mes y el reenvío no suma otro", async () => {
    const chk = await nuevoCheckout("mpsub.renueva");
    const preId = nextProviderId("PRE");
    const auth1 = nextProviderId("AUTH");

    stubMp({
      [`/authorized_payments/${auth1}`]: {
        id: auth1,
        preapproval_id: preId,
        status: "processed",
        transaction_amount: 480000,
        currency_id: "COP",
      },
      [`/preapproval/${preId}`]: {
        id: preId,
        status: "authorized",
        external_reference: chk.reference,
        payer_email: chk.email,
      },
    });
    await syncAuthorizedPayment(auth1);

    const primera = await db.enrollment.findFirstOrThrow({
      where: { mercadoPagoPreapprovalId: preId },
    });
    const t1 = primera.paidUntil!;

    // Segundo mes: otro cobro, ya sin referencia — se resuelve por el
    // preapproval, que es lo que trae la renovación.
    const auth2 = nextProviderId("AUTH");
    stubMp({
      [`/authorized_payments/${auth2}`]: {
        id: auth2,
        preapproval_id: preId,
        status: "processed",
        transaction_amount: 480000,
        currency_id: "COP",
      },
    });
    await syncAuthorizedPayment(auth2);

    const tras = await db.enrollment.findFirstOrThrow({
      where: { mercadoPagoPreapprovalId: preId },
      include: { payments: true },
    });
    const dias = (tras.paidUntil!.getTime() - t1.getTime()) / 86_400_000;
    expect(dias, `avanzó ${dias} días en vez de un mes`).toBeGreaterThanOrEqual(28);
    expect(dias).toBeLessThanOrEqual(31);
    expect(tras.payments).toHaveLength(2);

    await syncAuthorizedPayment(auth2);
    const reenvio = await db.enrollment.findFirstOrThrow({
      where: { mercadoPagoPreapprovalId: preId },
      include: { payments: true },
    });
    expect(
      reenvio.paidUntil!.getTime(),
      "un reenvío del mismo cobro regaló un mes de más"
    ).toBe(tras.paidUntil!.getTime());
    expect(reenvio.payments).toHaveLength(2);
  });

  test("cancelar NO recorta el acceso ya pagado", async () => {
    const chk = await nuevoCheckout("mpsub.cancela");
    const preId = nextProviderId("PRE");
    const authId = nextProviderId("AUTH");

    stubMp({
      [`/authorized_payments/${authId}`]: {
        id: authId,
        preapproval_id: preId,
        status: "processed",
        transaction_amount: 480000,
        currency_id: "COP",
      },
      [`/preapproval/${preId}`]: {
        id: preId,
        status: "authorized",
        external_reference: chk.reference,
        payer_email: chk.email,
      },
    });
    await syncAuthorizedPayment(authId);

    const antes = await db.enrollment.findFirstOrThrow({
      where: { mercadoPagoPreapprovalId: preId },
    });

    stubMp({
      [`/preapproval/${preId}`]: {
        id: preId,
        status: "cancelled",
        external_reference: chk.reference,
      },
    });
    await syncPreapproval(preId);

    const despues = await db.enrollment.findFirstOrThrow({
      where: { mercadoPagoPreapprovalId: preId },
    });
    expect(despues.subscriptionStatus).toBe(SubscriptionStatus.CANCELLED);
    expect(
      despues.paidUntil?.getTime(),
      "cancelar movió paidUntil: se estaría quedando con dinero de un mes cobrado"
    ).toBe(antes.paidUntil?.getTime());
    expect(despues.status).toBe("ACTIVE");
  });

  test("un cobro que MP no ha procesado todavía no abre acceso", async () => {
    const chk = await nuevoCheckout("mpsub.pendiente");
    const preId = nextProviderId("PRE");
    const authId = nextProviderId("AUTH");

    stubMp({
      [`/authorized_payments/${authId}`]: {
        id: authId,
        preapproval_id: preId,
        status: "pending",
        transaction_amount: 480000,
        currency_id: "COP",
      },
      [`/preapproval/${preId}`]: {
        id: preId,
        status: "authorized",
        external_reference: chk.reference,
      },
    });

    const r = await syncAuthorizedPayment(authId);
    expect(r.outcome).toBe("skipped");
    expect(
      await db.payment.findMany({
        where: { providerPaymentId: `preapproval:${authId}` },
      }),
      "se registró un cobro que Mercado Pago aún no había hecho"
    ).toHaveLength(0);
  });
});
