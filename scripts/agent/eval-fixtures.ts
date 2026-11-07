/**
 * Test data for the panel agents' evals, in neondb_dev only.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/agent/eval-fixtures.ts          # create / refresh
 *   bun --env-file=../dayana-pnl/.env scripts/agent/eval-fixtures.ts --clean  # remove
 *
 * One fictitious client («Valentina Prueba Eval») with a paid therapy in COP,
 * a paid workshop in USD, a declined PayPal attempt and a pending package, so
 * the stats questions have known answers. Everything it creates is findable
 * by the `evalfx-` / example.com markers, and `--clean` also removes what the
 * action evals may have left (the contact, promo code and memories they
 * create).
 */
import { EnrollmentStatus, PaymentProvider, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

if (new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname !== "/neondb_dev") {
  console.error("eval-fixtures: solo contra /neondb_dev.");
  process.exit(1);
}

export const FIXTURE = {
  phone: "+573005550199",
  email: "valentina.eval@example.com",
  name: "Valentina Prueba Eval",
  createdContactPhone: "+573005550101",
  promoCode: "EVALTEST10",
} as const;

const DAY = 24 * 3600_000;

const clean = async () => {
  const contacts = await prisma.contact.findMany({
    where: { phoneE164: { in: [FIXTURE.phone, FIXTURE.createdContactPhone] } },
    select: { id: true },
  });
  const ids = contacts.map((c) => c.id);
  await prisma.payment.deleteMany({ where: { providerPaymentId: { startsWith: "evalfx-" } } });
  await prisma.payment.deleteMany({ where: { enrollment: { contactId: { in: ids } } } });
  await prisma.enrollment.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { id: { in: ids } } });
  await prisma.promoCode.deleteMany({ where: { code: FIXTURE.promoCode } }).catch(() => undefined);
  // Memories the memory eval taught the dev OWNER (the eval login's account).
  await prisma.agentMemory.deleteMany({ where: { createdById: "staff_dev_owner" } });
  return ids.length;
};

const create = async () => {
  await clean();
  const now = Date.now();
  const contact = await prisma.contact.create({
    data: {
      phoneE164: FIXTURE.phone,
      phoneCountryIso: "CO",
      email: FIXTURE.email,
      firstName: "Valentina",
      lastName: "Prueba Eval",
      countryIso: "CO",
    },
  });
  const therapy = await prisma.enrollment.create({
    data: { contactId: contact.id, productId: "therapy-3", status: EnrollmentStatus.ACTIVE, sessionsTotal: 3, currency: "COP", amountMinor: 570000 },
  });
  const workshop = await prisma.enrollment.create({
    data: { contactId: contact.id, productId: "taller-tu-sanacion-con-el-dinero", status: EnrollmentStatus.ACTIVE, currency: "USD", amountMinor: 4900 },
  });
  await prisma.enrollment.create({
    data: { contactId: contact.id, productId: "therapy-6", status: EnrollmentStatus.PENDING_PAYMENT, sessionsTotal: 6, currency: "COP", amountMinor: 980000 },
  });
  await prisma.payment.createMany({
    data: [
      {
        enrollmentId: therapy.id,
        provider: PaymentProvider.MANUAL,
        providerPaymentId: "evalfx-therapy",
        status: PaymentStatus.APPROVED,
        currency: "COP",
        amountMinor: 570000,
        paidAt: new Date(now - 5 * DAY),
        createdAt: new Date(now - 5 * DAY),
      },
      {
        enrollmentId: workshop.id,
        provider: PaymentProvider.PAYPAL,
        providerPaymentId: "evalfx-workshop",
        status: PaymentStatus.APPROVED,
        currency: "USD",
        amountMinor: 4900,
        feeMinor: 240,
        netMinor: 4660,
        payerCountryIso: "CO",
        paidAt: new Date(now - 3 * DAY),
        createdAt: new Date(now - 3 * DAY),
      },
      {
        enrollmentId: workshop.id,
        provider: PaymentProvider.PAYPAL,
        providerPaymentId: "evalfx-declined",
        status: PaymentStatus.FAILED,
        currency: "USD",
        amountMinor: 4900,
        failureCode: "INSTRUMENT_DECLINED",
        failureMessage: "El banco rechazó la tarjeta",
        createdAt: new Date(now - 1 * DAY),
      },
    ],
  });
  return contact.id;
};

if (process.argv.includes("--clean")) {
  console.log(`eval-fixtures: limpiado (${await clean()} contactos).`);
} else {
  console.log(`eval-fixtures: listo (contacto ${await create()}).`);
}
process.exit(0);
