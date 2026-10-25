/**
 * Enlaces de pago con monto libre, de punta a punta, contra la base de
 * DESARROLLO. Nada sale de verdad: ni PayPal, ni Mercado Pago, ni correos.
 *
 * Recorre lo que cambió, en el orden en que le pasa a un cobro real:
 *
 * - crear el enlace (USD con ficha, COP abierto) y que el producto oculto
 *   «Pago personalizado» exista, inactivo, y no salga en Paquetes;
 * - la página lo resuelve con el precio del ENLACE, también desde otro país;
 * - sólo quien trae el token abre órdenes, y no con un enlace revocado;
 * - la cotización y la guarda de moneda (USD por PayPal, COP por Mercado Pago);
 * - un código promocional nunca aplica;
 * - la comprobación del monto cobrado (la de `capture-order` y el webhook):
 *   acepta el importe exacto y rechaza pagar de menos;
 * - el cobro aprobado cuelga la matrícula del producto oculto con el concepto y
 *   el monto, sella el enlace por su id, y un reintento no duplica nada;
 * - el flujo de Mercado Pago (pendiente → aprobado) deja UNA matrícula;
 * - un enlace ya pagado deja de aceptar órdenes.
 *
 * Crea sus propias filas y las borra al terminar. Necesita el entorno de la app
 * (la clave que firma la referencia, la base):
 *
 *   bun --env-file=../dayana-pnl/.env scripts/custom-payment-e2e.ts
 */
import { EnrollmentStatus, PaymentProvider, PaymentStatus } from "@prisma/client";
import { NextRequest } from "next/server";

import { POST as createPreferencePost } from "@/app/api/mercadopago/create-preference/route";
import { POST as createOrderPost } from "@/app/api/paypal/create-order/route";
import { POST as quotePost } from "@/app/api/payments/quote/route";
import { resolveCheckoutContactIdForPayment } from "@/lib/crm/checkout-enrollment";
import { findEnrollmentForCheckout, fulfillCheckoutPayment } from "@/lib/crm/checkout-fulfillment";
import { encodeCheckoutReference, parseCheckoutReference } from "@/lib/crm/checkout-reference";
import { authorizeCustomPlanOrder } from "@/lib/crm/custom-payment";
import { CUSTOM_PAYMENT_PRODUCT_ID, customPlanIdFor } from "@/lib/crm/custom-payment-rules";
import { assertPayPalCaptureAmount } from "@/lib/crm/enrollment-payment";
import { createEnrollment } from "@/lib/crm/enrollments";
import {
  createPaymentLink,
  resolvePaymentLink,
  resolvePaymentLinkOwner,
  revokePaymentLink,
} from "@/lib/crm/payment-links";
import { recordPayment } from "@/lib/crm/payments";
import { deactivateProduct, listSellableProducts, updateProduct } from "@/lib/crm/products-admin";
import { validatePromoCode } from "@/lib/crm/promo-codes";
import { prisma } from "@/lib/db";
import { getPlanFromDb, isActivePlanId } from "@/lib/plans-from-db";
import { grossUpUsd, paypalFee } from "@/lib/pricing/fees";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");

// Nada sale de verdad. Fuera de producción `recordPayment` siempre intenta
// avisar a Inngest: sin claves y apuntando a un puerto local cerrado, falla en
// el acto y sin tocar internet (deja una alerta interna que se limpia abajo).
process.env.NOTIFICATIONS_DRY_RUN = "true";
delete process.env.INNGEST_EVENT_KEY;
delete process.env.INNGEST_SIGNING_KEY;
process.env.INNGEST_DEV = "http://127.0.0.1:9";
process.env.MERCADOPAGO_ACCESS_TOKEN ||= "TEST-e2e-no-llega-a-mercado-pago";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};
const throws = async (fn: () => unknown): Promise<boolean> => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

const run = Date.now();
const json = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${run % 250}.1` },
    body: JSON.stringify(body),
  });

const created = { contactIds: [] as string[], linkIds: [] as string[] };

const main = async () => {
  const contact = await prisma.contact.create({
    data: {
      phoneE164: `+1555${String(run).slice(-7)}`,
      firstName: `E2E Pago libre ${run}`,
      source: "OTHER",
    },
    select: { id: true },
  });
  created.contactIds.push(contact.id);

  console.log("\n— Crear los enlaces");
  const usdLink = await createPaymentLink({
    contactId: contact.id,
    custom: { amountMinor: 25050, currency: "USD", concept: `E2E diferencia del paquete ${run}` },
    expiresInDays: 7,
  });
  created.linkIds.push(usdLink.id);
  const copLink = await createPaymentLink({
    custom: { amountMinor: 500000, currency: "COP", concept: `E2E abono ${run}` },
  });
  created.linkIds.push(copLink.id);

  check("el enlace cuelga del producto oculto", usdLink.product.id === CUSTOM_PAYMENT_PRODUCT_ID, usdLink.product);
  check(
    "guarda monto, moneda y concepto",
    usdLink.customAmountMinor === 25050 &&
      usdLink.customCurrency === "USD" &&
      usdLink.customConcept === `E2E diferencia del paquete ${run}`,
    usdLink,
  );
  check("un enlace libre no acepta producto a la vez", await throws(() =>
    createPaymentLink({ productId: "therapy-1", custom: { amountMinor: 1000, currency: "USD", concept: "x" } }),
  ));
  check("sin producto ni monto no se crea", await throws(() => createPaymentLink({})));

  const hidden = await prisma.product.findUnique({ where: { id: CUSTOM_PAYMENT_PRODUCT_ID } });
  check("el producto oculto existe, es OTHER, inactivo y sin precios", !!hidden && hidden.kind === "OTHER" && !hidden.isActive, hidden);
  check(
    "el producto oculto NO sale en Paquetes",
    !(await listSellableProducts()).some((p) => p.id === CUSTOM_PAYMENT_PRODUCT_ID),
  );

  const usdPlanId = customPlanIdFor(usdLink.id);
  const copPlanId = customPlanIdFor(copLink.id);

  console.log("\n— La página resuelve el enlace");
  const fromCo = await resolvePaymentLink(usdLink.token, true);
  const fromUs = await resolvePaymentLink(usdLink.token, false);
  check("el precio es el del enlace (250.50 USD)", fromCo?.plan.amountUsd === 250.5 && fromUs?.plan.amountUsd === 250.5, fromCo?.plan);
  check("un enlace en USD se ve igual desde Colombia (la moneda decide, no el país)", !!fromCo && fromCo.custom?.currency === "USD");
  check("el precio se pinta con centavos", fromCo?.custom?.amountLabel === "$250.50 USD", fromCo?.custom);
  check("el título de la página es el concepto", fromCo?.plan.title === `E2E diferencia del paquete ${run}`);
  const copPage = await resolvePaymentLink(copLink.token, false);
  check("un enlace en COP se ve desde fuera de Colombia", copPage?.plan.amountCop === 500000 && copPage.custom?.currency === "COP", copPage?.custom);
  check("el enlace abierto no tiene ficha", copPage?.contact === null);

  console.log("\n— El portón de planes");
  check("getPlanFromDb resuelve el id del enlace", (await getPlanFromDb(usdPlanId))?.amountUsd === 250.5);
  check("isActivePlanId lo acepta", (await isActivePlanId(usdPlanId)) === true);
  check("un id de enlace que no existe se rechaza", (await isActivePlanId("enlace-zzzzzzzzzzzzzzzzzz")) === false);
  check("el producto oculto no se vende como plan", (await getPlanFromDb(CUSTOM_PAYMENT_PRODUCT_ID)) === null);

  console.log("\n— Quién puede abrir una orden");
  check("el token del enlace sí", await authorizeCustomPlanOrder(usdPlanId, usdLink.token));
  check("el token de OTRO enlace no", !(await authorizeCustomPlanOrder(usdPlanId, copLink.token)));
  check("sin token no", !(await authorizeCustomPlanOrder(usdPlanId, undefined)));
  check("con un token inventado no", !(await authorizeCustomPlanOrder(usdPlanId, "x".repeat(32))));
  check("un producto normal no exige token", await authorizeCustomPlanOrder("therapy-1", undefined));
  const owner = await resolvePaymentLinkOwner(usdLink.token);
  check("el dueño del cobro es la ficha del enlace y su plan es el del enlace", owner?.contactId === contact.id && owner.productIds[0] === usdPlanId && owner.productIds.length === 1, owner);

  console.log("\n— Cotización, promos y guarda de moneda");
  const quoteUsd = await (await quotePost(json("/api/payments/quote", { planId: usdPlanId, provider: "paypal" }))).json();
  const expectedGross = grossUpUsd(250.5, paypalFee()).gross;
  check("cotiza USD por PayPal con la comisión encima", quoteUsd.subtotal === "250.50" && quoteUsd.total === expectedGross.toFixed(2) && quoteUsd.currency === "USD", quoteUsd);
  check("no ofrece campo de promo", quoteUsd.promoAvailable === false, quoteUsd);
  const quotePromo = await (await quotePost(json("/api/payments/quote", { planId: usdPlanId, provider: "paypal", promoCode: "CUALQUIERA" }))).json();
  check("un código promocional se rechaza", !!quotePromo.promoCodeError && quotePromo.discountMinor === 0, quotePromo);
  const promo = await validatePromoCode("CUALQUIERA", "USD", 25050, usdPlanId);
  check("validatePromoCode lo rechaza por producto no elegible", !promo.ok && promo.error === "product_not_eligible", promo);
  const quoteCop = await (await quotePost(json("/api/payments/quote", { planId: copPlanId, provider: "mercadopago" }))).json();
  check("cotiza COP por Mercado Pago", quoteCop.currency === "COP" && quoteCop.subtotal === "500000" && Number(quoteCop.total) > 500000, quoteCop);
  const wrongRail = await quotePost(json("/api/payments/quote", { planId: usdPlanId, provider: "mercadopago" }));
  check("un enlace en USD no se cotiza por Mercado Pago", wrongRail.status === 400, wrongRail.status);

  const noTokenOrder = await createOrderPost(json("/api/paypal/create-order", { planId: usdPlanId }));
  check("create-order sin token → 403", noTokenOrder.status === 403 && (await noTokenOrder.json()).error === "link_unavailable");
  const copOnPayPal = await createOrderPost(json("/api/paypal/create-order", { planId: copPlanId, paymentLinkToken: copLink.token }));
  check("un enlace en COP no abre orden en PayPal (evita una orden de 0 USD)", copOnPayPal.status === 400 && (await copOnPayPal.json()).error === "wrong_currency");
  const noTokenPref = await createPreferencePost(json("/api/mercadopago/create-preference", { planId: copPlanId }));
  check("create-preference sin token → 403", noTokenPref.status === 403);
  const usdOnMp = await createPreferencePost(json("/api/mercadopago/create-preference", { planId: usdPlanId, paymentLinkToken: usdLink.token }));
  check("un enlace en USD no abre preferencia en Mercado Pago", usdOnMp.status === 400 && (await usdOnMp.json()).error === "no_cop_price");

  console.log("\n— La comprobación del monto cobrado (capture-order y webhook)");
  const gross = (await getPlanFromDb(usdPlanId)) && grossUpUsd((await getPlanFromDb(usdPlanId))!.amountUsd, paypalFee()).gross;
  const grossMinor = Math.round((gross as number) * 100);
  check("acepta el importe exacto", !(await throws(() => assertPayPalCaptureAmount(grossMinor, "USD", gross as number))));
  check("rechaza pagar de menos (sin la comisión)", await throws(() => assertPayPalCaptureAmount(25050, "USD", gross as number)));
  check("rechaza un centavo menos", await throws(() => assertPayPalCaptureAmount(grossMinor - 1, "USD", gross as number)));

  console.log("\n— Cobro aprobado por PayPal (USD, con ficha)");
  const payerContactId = await resolveCheckoutContactIdForPayment({
    planId: usdPlanId,
    contact: {},
    paymentLinkToken: usdLink.token,
  });
  check("el cobro se cuelga de la ficha del enlace, no de un contacto temporal", payerContactId === contact.id, payerContactId);
  const ref = encodeCheckoutReference(payerContactId, usdPlanId);
  check("la referencia firmada viaja con el id del enlace y cabe en custom_id", parseCheckoutReference(ref)?.planId === usdPlanId && ref.length <= 127, ref.length);

  const ppId = `e2e-pp-${run}`;
  const enrollmentId = await fulfillCheckoutPayment({
    contactId: payerContactId,
    productId: usdPlanId,
    provider: PaymentProvider.PAYPAL,
    providerPaymentId: ppId,
    status: PaymentStatus.APPROVED,
    currency: "USD",
    amountMinor: grossMinor,
    paidAt: new Date(),
  });
  const enr = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, include: { product: true, payments: true } });
  check("la matrícula cuelga del producto oculto", enr?.productId === CUSTOM_PAYMENT_PRODUCT_ID && enr.product.kind === "OTHER", enr?.productId);
  check("la matrícula lleva el concepto y el monto acordado", enr?.label === `E2E diferencia del paquete ${run}` && enr.amountMinor === 25050 && enr.currency === "USD", enr && { label: enr.label, amountMinor: enr.amountMinor, currency: enr.currency });
  check("la matrícula queda ACTIVA", enr?.status === EnrollmentStatus.ACTIVE, enr?.status);
  check("un solo pago, aprobado, por lo que cobró PayPal", enr?.payments.length === 1 && enr.payments[0].status === PaymentStatus.APPROVED && enr.payments[0].amountMinor === grossMinor, enr?.payments);
  check("no concede membresía ni acceso", enr?.paidUntil === null && enr.payments[0].membershipAppliedAt === null && enr.lifetimeAccess === false);
  const paidLink = await prisma.paymentLink.findUnique({ where: { id: usdLink.id } });
  check("el enlace queda sellado por su id", !!paidLink?.paidAt && paidLink.enrollmentId === enrollmentId, paidLink);
  const again = await fulfillCheckoutPayment({
    contactId: payerContactId,
    productId: usdPlanId,
    provider: PaymentProvider.PAYPAL,
    providerPaymentId: ppId,
    status: PaymentStatus.APPROVED,
    currency: "USD",
    amountMinor: grossMinor,
    paidAt: new Date(),
  });
  check("el reintento del webhook devuelve la misma matrícula", again === enrollmentId);
  check("y no duplica nada", (await prisma.payment.count({ where: { enrollmentId } })) === 1 && (await prisma.enrollment.count({ where: { contactId: contact.id } })) === 1);
  check("un enlace pagado ya no abre órdenes", !(await authorizeCustomPlanOrder(usdPlanId, usdLink.token)));
  check("y la página lo dice (no es un 404)", (await resolvePaymentLink(usdLink.token, false))?.custom?.paid === true);

  console.log("\n— Cobro por Mercado Pago (COP, enlace abierto: pendiente → aprobado)");
  const tempContactId = await resolveCheckoutContactIdForPayment({ planId: copPlanId, contact: {}, paymentLinkToken: copLink.token });
  created.contactIds.push(tempContactId);
  check("un enlace abierto cae en el camino anónimo (contacto temporal)", tempContactId !== contact.id);
  const mpId = `e2e-mp-${run}`;
  const pending = await createEnrollment({ contactId: tempContactId, productId: copPlanId, status: EnrollmentStatus.PENDING_PAYMENT, paidPurchase: true });
  check("la matrícula pendiente ya lleva el concepto y el monto", pending.label === `E2E abono ${run}` && pending.amountMinor === 500000 && pending.currency === "COP", { label: pending.label, a: pending.amountMinor, c: pending.currency });
  check("guarda el id del enlace para poder volver a encontrarla", pending.externalRef === copLink.id, pending.externalRef);
  check("el siguiente aviso de Mercado Pago reencuentra ESA matrícula (no abre otra pendiente)", (await findEnrollmentForCheckout(tempContactId, copPlanId)) === pending.id);
  const otherLink = await createPaymentLink({ custom: { amountMinor: 7000, currency: "COP", concept: `E2E otro ${run}` }, expiresInDays: 1 });
  created.linkIds.push(otherLink.id);
  check("y no se mezcla con la matrícula de OTRO enlace de la misma persona", (await findEnrollmentForCheckout(tempContactId, customPlanIdFor(otherLink.id))) === null);
  await recordPayment({ enrollmentId: pending.id, provider: PaymentProvider.MERCADO_PAGO, providerPaymentId: mpId, status: PaymentStatus.PENDING, currency: "COP", amountMinor: 524934 });
  const approvedEnrollmentId = await fulfillCheckoutPayment({
    contactId: tempContactId,
    productId: copPlanId,
    provider: PaymentProvider.MERCADO_PAGO,
    providerPaymentId: mpId,
    status: PaymentStatus.APPROVED,
    currency: "COP",
    amountMinor: 524934,
    paidAt: new Date(),
  });
  check("el aviso aprobado reutiliza LA MISMA matrícula", approvedEnrollmentId === pending.id);
  const mpEnr = await prisma.enrollment.findUnique({ where: { id: approvedEnrollmentId }, include: { payments: true } });
  check("queda ACTIVA con un solo pago aprobado", mpEnr?.status === EnrollmentStatus.ACTIVE && mpEnr.payments.length === 1 && mpEnr.payments[0].status === PaymentStatus.APPROVED, mpEnr && { s: mpEnr.status, p: mpEnr.payments.map((p) => p.status) });
  const copPaid = await prisma.paymentLink.findUnique({ where: { id: copLink.id } });
  check("el enlace abierto también se sella (se paga una sola vez)", !!copPaid?.paidAt && copPaid.enrollmentId === approvedEnrollmentId, copPaid);
  const usdStill = await prisma.paymentLink.findUnique({ where: { id: usdLink.id } });
  check("sellar uno no toca el otro", usdStill?.enrollmentId === enrollmentId);

  console.log("\n— Doble cobro en un enlace ya pagado");
  const secondEnrollmentId = await fulfillCheckoutPayment({
    contactId: payerContactId,
    productId: usdPlanId,
    provider: PaymentProvider.PAYPAL,
    providerPaymentId: `${ppId}-segundo`,
    status: PaymentStatus.APPROVED,
    currency: "USD",
    amountMinor: grossMinor,
    paidAt: new Date(),
  });
  check("el segundo cobro NO se rechaza (el dinero ya entró): queda registrado", secondEnrollmentId !== enrollmentId && (await prisma.payment.count({ where: { providerPaymentId: `${ppId}-segundo` } })) === 1);
  const stillFirst = await prisma.paymentLink.findUnique({ where: { id: usdLink.id } });
  check("el enlace sigue sellado con el primer cobro", stillFirst?.enrollmentId === enrollmentId);
  // `fireNotification` escribe en segundo plano (no bloquea el cobro): se espera
  // a que llegue en vez de consultar al instante.
  let alerts = await prisma.platformNotification.findMany({ where: { entityId: secondEnrollmentId, title: "Enlace de monto libre cobrado dos veces" } });
  for (let i = 0; i < 20 && alerts.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 500));
    alerts = await prisma.platformNotification.findMany({ where: { entityId: secondEnrollmentId, title: "Enlace de monto libre cobrado dos veces" } });
  }
  check("el equipo recibe la alerta para devolver el que sobra", alerts.length === 1, alerts.length);
  const retryAlerts = await prisma.platformNotification.count({ where: { entityId: enrollmentId, title: "Enlace de monto libre cobrado dos veces" } });
  check("y el reintento del PRIMER cobro no dispara falsa alarma", retryAlerts === 0, retryAlerts);

  console.log("\n— El producto oculto no se puede activar ni editar");
  check("updateProduct lo trata como inexistente", await throws(() => updateProduct(CUSTOM_PAYMENT_PRODUCT_ID, { isActive: true, amountUsd: 10 })));
  check("deactivateProduct también", await throws(() => deactivateProduct(CUSTOM_PAYMENT_PRODUCT_ID)));
  const stillHidden = await prisma.product.findUnique({ where: { id: CUSTOM_PAYMENT_PRODUCT_ID }, include: { prices: true } });
  check("sigue inactivo y sin precios", stillHidden?.isActive === false && stillHidden.prices.length === 0, stillHidden);

  console.log("\n— Un enlace revocado no abre órdenes");
  const revoked = await createPaymentLink({ contactId: contact.id, custom: { amountMinor: 10000, currency: "USD", concept: `E2E revocado ${run}` } });
  created.linkIds.push(revoked.id);
  const revokedPlan = customPlanIdFor(revoked.id);
  check("vivo, sí", await authorizeCustomPlanOrder(revokedPlan, revoked.token));
  await revokePaymentLink(revoked.id);
  check("revocado, no", !(await authorizeCustomPlanOrder(revokedPlan, revoked.token)));
  check("y la página responde 404", (await resolvePaymentLink(revoked.token, false)) === null);
  check("pero lo ya cobrado seguiría resolviendo su plan (un pago en vuelo no se rechaza)", (await getPlanFromDb(revokedPlan))?.amountUsd === 100);

  console.log("\n— Un enlace de producto sigue igual");
  const normal = await createPaymentLink({ contactId: contact.id, productId: "therapy-1" }).catch(() => null);
  if (normal) {
    created.linkIds.push(normal.id);
    check("guarda sin monto libre", normal.customAmountMinor === null && normal.customConcept === null);
    check("y se resuelve por el catálogo", (await resolvePaymentLink(normal.token, false))?.custom === undefined);
  } else {
    console.log("  ⚠️  therapy-1 no existe en la base de desarrollo: se omite");
  }
};

const cleanup = async () => {
  const enrollments = await prisma.enrollment.findMany({
    where: { contactId: { in: created.contactIds } },
    select: { id: true, payments: { select: { id: true } } },
  });
  const entityIds = [
    ...created.contactIds,
    ...enrollments.map((e) => e.id),
    ...enrollments.flatMap((e) => e.payments.map((p) => p.id)),
  ];
  await prisma.paymentLink.deleteMany({ where: { id: { in: created.linkIds } } });
  await prisma.platformNotification.deleteMany({ where: { entityId: { in: entityIds } } });
  // Borrar el contacto arrastra sus matrículas y pagos (cascada).
  await prisma.contact.deleteMany({ where: { id: { in: created.contactIds } } });
};

main()
  .catch((e) => {
    console.error(e);
    failures.push(`excepción: ${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("limpieza:", e));
    await prisma.$disconnect();
    console.log(failures.length ? `\n❌ ${failures.length} fallo(s):\n - ${failures.join("\n - ")}` : "\n✅ Todo en orden");
    process.exit(failures.length ? 1 : 0);
  });
