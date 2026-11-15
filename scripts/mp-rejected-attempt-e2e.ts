/**
 * Un intento rechazado de Mercado Pago queda en Pagos aunque MP no mande email.
 *
 * Caso real (Lenis, 14-nov-2026): dos intentos con Nequi por Mercado Pago, MP
 * los rechazó con `bank_error` y mandó el nombre pero no el email. El CRM avisó
 * «Pago rechazado» y en el mismo instante borró la matrícula y el pago
 * (`abandonCheckoutEnrollment`), así que en Pagos no quedó nada.
 *
 * Solo contra `neondb_dev`. Falsea `api.mercadopago.com`; no llama a nadie.
 *
 *   bun --env-file=.env scripts/mp-rejected-attempt-e2e.ts
 */
import { PaymentStatus } from "@prisma/client";
import { prisma } from "../lib/db";
import {
  abandonStalePlaceholderCheckouts,
  createPendingCheckoutContact,
} from "../lib/crm/checkout-placeholder";
import { encodeCheckoutReference } from "../lib/crm/checkout-reference";
import { syncMercadoPagoPayment } from "../lib/crm/mercadopago-payments";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("neondb_dev")) {
  console.error("Esta prueba solo corre contra neondb_dev.");
  process.exit(2);
}

const PLAN = "therapy-1";
const realFetch = globalThis.fetch;
const stub = (byId: Record<string, Record<string, unknown>>) => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input.toString();
    const m = u.match(/api\.mercadopago\.com\/v1\/payments\/([^/?]+)/);
    if (!m) return realFetch(input as RequestInfo, init);
    const body = byId[m[1]];
    if (!body) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
};

let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "OK  " : "FALLA"} ${label}`);
  if (!ok) failures += 1;
};

const contactIds: string[] = [];

const main = async () => {
  process.env.MERCADOPAGO_ACCESS_TOKEN ||= "TEST-e2e-fake";
  const mpId = `9${Date.now()}`;

  // 1. Checkout como el de la página: contacto temporal + referencia firmada.
  const contactId = await createPendingCheckoutContact(PLAN);
  contactIds.push(contactId);
  stub({
    [mpId]: {
      id: Number(mpId),
      status: "rejected",
      status_detail: "bank_error",
      currency_id: "COP",
      transaction_amount: 199475,
      external_reference: encodeCheckoutReference(contactId, PLAN),
      // Lo que mandó MP con Nequi: nombre sí, email y teléfono no.
      payer: { first_name: "Lenis Johana", last_name: "E2E" },
    },
  });
  const r = await syncMercadoPagoPayment(mpId);
  check(r.outcome === "recorded", `el rechazo se registra (${JSON.stringify(r)})`);

  const pago = await prisma.payment.findFirst({
    where: { providerPaymentId: mpId },
    include: { enrollment: { include: { contact: true } } },
  });
  check(Boolean(pago), "el pago rechazado sigue en la base después de avisar");
  check(pago?.status === PaymentStatus.FAILED, "queda como FAILED");
  check(pago?.failureCode === "bank_error", "guarda el código crudo bank_error");
  check(
    Boolean(pago?.failureMessage?.includes("Nequi")),
    `el motivo está traducido («${pago?.failureMessage}»)`
  );
  check(pago?.enrollment.contact.firstName === "Lenis Johana", "el contacto lleva el nombre del pagador");

  // 2. La limpieza nocturna no se lo lleva aunque pasen días.
  if (pago) {
    await prisma.enrollment.update({
      where: { id: pago.enrollmentId },
      data: { createdAt: new Date(Date.now() - 72 * 3600 * 1000) },
    });
  }

  // 3. Un checkout abandonado de verdad (sin ningún pago) sí se barre.
  const abandonedContact = await createPendingCheckoutContact(PLAN);
  contactIds.push(abandonedContact);
  const abandonedEnrollment = await prisma.enrollment.create({
    data: {
      contactId: abandonedContact,
      productId: PLAN,
      status: "PENDING_PAYMENT",
      createdAt: new Date(Date.now() - 72 * 3600 * 1000),
    },
    select: { id: true },
  });

  await abandonStalePlaceholderCheckouts();

  check(
    Boolean(pago && (await prisma.payment.findUnique({ where: { id: pago.id } }))),
    "la limpieza nocturna conserva el intento rechazado"
  );
  check(
    !(await prisma.enrollment.findUnique({ where: { id: abandonedEnrollment.id } })),
    "la limpieza nocturna sigue borrando el checkout sin pago"
  );
};

main()
  .catch((e) => {
    console.error(e);
    failures += 1;
  })
  .finally(async () => {
    globalThis.fetch = realFetch;
    await prisma.contact.deleteMany({ where: { id: { in: contactIds } } }).catch(() => undefined);
    await prisma.$disconnect();
    console.log(failures ? `\n${failures} fallo(s)` : "\nTodo bien");
    process.exit(failures ? 1 : 0);
  });
