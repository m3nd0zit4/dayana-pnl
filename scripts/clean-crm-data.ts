/**
 * Removes operational CRM data; keeps catalog (products, workshops, templates, tags, staff).
 * Usage: bunx tsx scripts/clean-crm-data.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const before = {
    contacts: await prisma.contact.count(),
    enrollments: await prisma.enrollment.count(),
    payments: await prisma.payment.count(),
  };

  await prisma.$transaction([
    prisma.notificationDelivery.deleteMany(),
    prisma.notificationCampaign.deleteMany(),
    prisma.messageLog.deleteMany(),
    prisma.contactNotebookPage.deleteMany(),
    prisma.contactTag.deleteMany(),
    prisma.therapySession.deleteMany(),
    prisma.therapyPackage.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.enrollment.deleteMany(),
    prisma.webhookEvent.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.staffSession.deleteMany(),
    prisma.contact.deleteMany(),
  ]);

  const after = {
    contacts: await prisma.contact.count(),
    enrollments: await prisma.enrollment.count(),
    payments: await prisma.payment.count(),
    products: await prisma.product.count(),
    staff: await prisma.staffUser.count(),
    templates: await prisma.messageTemplate.count(),
  };

  console.log(JSON.stringify({ before, after }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
