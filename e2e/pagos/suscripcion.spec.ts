// Antes que nada: engancha el alias `@/` para los import() diferidos.
import "./alias";

import { test, expect } from "@playwright/test";
import { nextProviderId, testEmail, cleanupTestData, db } from "./helpers";
import { encodeCheckoutReference } from "../../lib/crm/checkout-reference";
import {
  syncSubscriptionActivated,
  syncSubscriptionPayment,
  syncSubscriptionStatus,
} from "../../lib/crm/paypal-subscriptions";
import { SubscriptionStatus } from "@prisma/client";

/**
 * Suscripción recurrente de la mensualidad.
 *
 * Los eventos de PayPal se inyectan directamente en la capa que los procesa:
 * `BILLING.*` y `PAYMENT.SALE.*` llegan firmados por PayPal y no se pueden
 * fabricar contra la ruta HTTP sin el bypass, igual que ya pasa con los
 * estados de Mercado Pago.
 */

const MEMBRESIA = "course-live";

/** Contacto temporal como el que crea el checkout, más su referencia firmada. */
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

test.afterAll(async () => {
  await cleanupTestData();
  await db.$disconnect();
});

test.describe("Suscripción · PayPal", () => {
  test("el primer cobro crea la matrícula, la enlaza y da un mes", async () => {
    const chk = await nuevoCheckout("sub.primera");
    const subId = nextProviderId("I-SUB");
    const saleId = nextProviderId("SALE");

    // El cobro puede adelantarse a ACTIVATED: no hay orden garantizado.
    const cobro = await syncSubscriptionPayment({
      id: saleId,
      billing_agreement_id: subId,
      amount: { total: "37.32", currency: "USD" },
      custom: chk.reference,
      payer: {
        email_address: chk.email,
        name: { given_name: "Laura", surname: "Vélez" },
      },
    });
    expect(cobro.outcome, JSON.stringify(cobro)).toBe("recorded");

    const enrollment = await db.enrollment.findFirstOrThrow({
      where: { contactId: chk.contactId, productId: MEMBRESIA },
      include: { payments: true },
    });

    expect(
      enrollment.paypalSubscriptionId,
      "la matrícula quedó sin el id de suscripción; las renovaciones no la encontrarían"
    ).toBe(subId);
    expect(enrollment.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
    expect(enrollment.status).toBe("ACTIVE");
    expect(enrollment.paidUntil, "el primer cobro no abrió acceso").toBeTruthy();
    expect(enrollment.payments).toHaveLength(1);

    // El id va namespaceado para no chocar con un capture de orden.
    expect(enrollment.payments[0].providerPaymentId).toBe(`sale:${saleId}`);
  });

  test("la renovación suma exactamente un mes y no duplica el pago", async () => {
    const chk = await nuevoCheckout("sub.renueva");
    const subId = nextProviderId("I-SUB");

    await syncSubscriptionPayment({
      id: nextProviderId("SALE"),
      billing_agreement_id: subId,
      amount: { total: "37.32", currency: "USD" },
      custom: chk.reference,
      payer: { email_address: chk.email },
    });

    const primera = await db.enrollment.findFirstOrThrow({
      where: { paypalSubscriptionId: subId },
    });
    const t1 = primera.paidUntil!;

    // Segundo mes: otro sale id, ya sin referencia — se resuelve por el
    // acuerdo de facturación, que es lo que manda PayPal en las renovaciones.
    const segundo = nextProviderId("SALE");
    await syncSubscriptionPayment({
      id: segundo,
      billing_agreement_id: subId,
      amount: { total: "37.32", currency: "USD" },
    });

    const tras = await db.enrollment.findFirstOrThrow({
      where: { paypalSubscriptionId: subId },
      include: { payments: true },
    });
    const dias = (tras.paidUntil!.getTime() - t1.getTime()) / 86_400_000;
    expect(dias, `avanzó ${dias} días en vez de un mes`).toBeGreaterThanOrEqual(28);
    expect(dias).toBeLessThanOrEqual(31);
    expect(tras.payments).toHaveLength(2);

    // El mismo evento repetido no regala otro mes.
    await syncSubscriptionPayment({
      id: segundo,
      billing_agreement_id: subId,
      amount: { total: "37.32", currency: "USD" },
    });
    const reenvio = await db.enrollment.findFirstOrThrow({
      where: { paypalSubscriptionId: subId },
      include: { payments: true },
    });
    expect(
      reenvio.paidUntil!.getTime(),
      "un reenvío del mismo cobro regaló un mes de más"
    ).toBe(tras.paidUntil!.getTime());
    expect(reenvio.payments).toHaveLength(2);
  });

  test("ACTIVATED enlaza la suscripción y completa el contacto temporal", async () => {
    const chk = await nuevoCheckout("sub.activada");
    const subId = nextProviderId("I-SUB");

    await syncSubscriptionPayment({
      id: nextProviderId("SALE"),
      billing_agreement_id: subId,
      amount: { total: "37.32", currency: "USD" },
      custom: chk.reference,
    });

    await syncSubscriptionActivated({
      id: subId,
      custom_id: chk.reference,
      subscriber: {
        email_address: chk.email,
        name: { given_name: "Paula", surname: "Ríos" },
      },
    });

    const contacto = await db.contact.findUniqueOrThrow({
      where: { id: chk.contactId },
    });
    expect(contacto.email).toBe(chk.email);
    expect(contacto.firstName).toBe("Paula");
  });

  test("cancelar NO recorta el acceso ya pagado", async () => {
    const chk = await nuevoCheckout("sub.cancela");
    const subId = nextProviderId("I-SUB");

    await syncSubscriptionPayment({
      id: nextProviderId("SALE"),
      billing_agreement_id: subId,
      amount: { total: "37.32", currency: "USD" },
      custom: chk.reference,
    });

    const antes = await db.enrollment.findFirstOrThrow({
      where: { paypalSubscriptionId: subId },
    });

    await syncSubscriptionStatus({ id: subId }, SubscriptionStatus.CANCELLED);

    const despues = await db.enrollment.findFirstOrThrow({
      where: { paypalSubscriptionId: subId },
    });
    expect(despues.subscriptionStatus).toBe(SubscriptionStatus.CANCELLED);
    expect(
      despues.paidUntil?.getTime(),
      "cancelar movió paidUntil: se estaría quedando con dinero de un mes ya cobrado"
    ).toBe(antes.paidUntil?.getTime());
    expect(
      despues.status,
      "cancelar cerró la matrícula antes de tiempo"
    ).toBe("ACTIVE");
  });

  test("un cobro sin acuerdo de facturación no se trata como suscripción", async () => {
    const r = await syncSubscriptionPayment({
      id: nextProviderId("SALE"),
      amount: { total: "37.32", currency: "USD" },
    });
    expect(r).toEqual({ outcome: "skipped", reason: "not_a_subscription_sale" });
  });
});
