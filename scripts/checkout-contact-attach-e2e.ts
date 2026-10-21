/**
 * El formulario de `/pago/exito` no puede borrar el pago que acaba de entrar.
 * Contra la base de DESARROLLO.
 *
 *   bun scripts/checkout-contact-attach-e2e.ts
 *
 * Qué pasaba (21-oct-2026): quien paga por PayPal sin formulario queda con un
 * contacto temporal (`+pending:`). Al dejar su teléfono en `/pago/exito`,
 * `/api/leads` llamaba a `attachContactToEnrollment`, que BORRABA el temporal
 * antes de mover la matrícula. `Enrollment.contact` y `Payment.enrollment`
 * cascadean: se iban la matrícula y el pago. Cinco cobros de PayPal
 * (1.338,79 USD) desaparecieron así entre el 5-sep y el 17-oct.
 *
 * Casos:
 * 1. Teléfono nuevo: la matrícula y el pago pasan a la ficha real y el
 *    temporal se borra.
 * 2. Teléfono de una ficha que ya existía: igual, a esa ficha.
 * 3. El temporal tiene otra matrícula: se mueve solo la pagada y el temporal
 *    se queda (lo barre la limpieza nocturna si nunca paga).
 * 4. Matrícula que no existe: devuelve null sin tocar nada.
 */
import { EnrollmentStatus, PaymentProvider, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createPendingCheckoutContact } from "@/lib/crm/checkout-placeholder";
import { attachContactToEnrollment } from "@/lib/crm/enrollments";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";
delete process.env.INNGEST_EVENT_KEY;
delete process.env.INNGEST_SIGNING_KEY;

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const RUN = Date.now().toString(36);
const createdContacts: string[] = [];

const product = await prisma.product.findFirst({
  where: { id: { startsWith: "therapy-" } },
  select: { id: true },
});
if (!product) throw new Error("No hay producto de terapia en la base de desarrollo.");

/** Un cobro de PayPal ya registrado sobre el contacto temporal, como lo deja el webhook. */
const paidOnPlaceholder = async (tag: string) => {
  const placeholderId = await createPendingCheckoutContact(product.id);
  createdContacts.push(placeholderId);
  const enrollment = await prisma.enrollment.create({
    data: { contactId: placeholderId, productId: product.id, status: EnrollmentStatus.ACTIVE },
    select: { id: true },
  });
  const payment = await prisma.payment.create({
    data: {
      enrollmentId: enrollment.id,
      provider: PaymentProvider.PAYPAL,
      providerPaymentId: `E2E-ATTACH-${RUN}-${tag}`,
      status: PaymentStatus.APPROVED,
      currency: "USD",
      amountMinor: 74027,
      paidAt: new Date(),
    },
    select: { id: true },
  });
  return { placeholderId, enrollmentId: enrollment.id, paymentId: payment.id };
};

const realContact = async (tag: string) => {
  const contact = await prisma.contact.create({
    data: { phoneE164: `+5730000${RUN.slice(-4)}${tag}`.slice(0, 16), firstName: `E2E ${tag}` },
    select: { id: true },
  });
  createdContacts.push(contact.id);
  return contact.id;
};

const survived = async (
  name: string,
  ids: { placeholderId: string; enrollmentId: string; paymentId: string },
  contactId: string,
  placeholderShouldRemain: boolean
) => {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: ids.enrollmentId },
    select: { contactId: true, status: true },
  });
  const payment = await prisma.payment.findUnique({
    where: { id: ids.paymentId },
    select: { enrollmentId: true, status: true },
  });
  const placeholder = await prisma.contact.findUnique({
    where: { id: ids.placeholderId },
    select: { id: true },
  });
  check(`${name}: la matrícula sigue y es de la ficha real`, enrollment?.contactId === contactId, enrollment);
  check(`${name}: la matrícula sigue activa`, enrollment?.status === EnrollmentStatus.ACTIVE, enrollment);
  check(`${name}: el pago sigue aprobado en esa matrícula`, payment?.enrollmentId === ids.enrollmentId && payment?.status === PaymentStatus.APPROVED, payment);
  check(
    `${name}: el temporal ${placeholderShouldRemain ? "se queda" : "se borra"}`,
    placeholderShouldRemain ? placeholder !== null : placeholder === null,
    placeholder
  );
};

try {
  console.log("1. Teléfono nuevo en /pago/exito");
  {
    const ids = await paidOnPlaceholder("new");
    const contactId = await realContact("1");
    await attachContactToEnrollment(ids.enrollmentId, contactId);
    await survived("teléfono nuevo", ids, contactId, false);
  }

  console.log("2. Teléfono de una ficha que ya existía");
  {
    const contactId = await realContact("2");
    const ids = await paidOnPlaceholder("existing");
    await attachContactToEnrollment(ids.enrollmentId, contactId);
    await survived("ficha existente", ids, contactId, false);
  }

  console.log("3. El temporal tiene otra matrícula");
  {
    const ids = await paidOnPlaceholder("other");
    const other = await prisma.enrollment.create({
      data: { contactId: ids.placeholderId, productId: product.id, status: EnrollmentStatus.PENDING_PAYMENT },
      select: { id: true },
    });
    const contactId = await realContact("3");
    await attachContactToEnrollment(ids.enrollmentId, contactId);
    await survived("con otra matrícula", ids, contactId, true);
    const otherRow = await prisma.enrollment.findUnique({ where: { id: other.id }, select: { contactId: true } });
    check("con otra matrícula: la otra sigue en el temporal", otherRow?.contactId === ids.placeholderId, otherRow);
  }

  console.log("4. Matrícula que no existe");
  {
    const contactId = await realContact("4");
    const result = await attachContactToEnrollment(`no-existe-${RUN}`, contactId);
    check("no existe: devuelve null", result === null, result);
  }
} finally {
  await prisma.contact.deleteMany({ where: { id: { in: createdContacts } } });
  await prisma.$disconnect();
}

if (failures.length) {
  console.log(`\n❌ ${failures.length} fallo(s)`);
  process.exit(1);
}
console.log("\n✅ Todo bien");
