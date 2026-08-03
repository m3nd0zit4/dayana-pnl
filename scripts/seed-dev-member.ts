/**
 * One-off: seed a test member with an active course enrollment, a published
 * module, and a class with a legacy recording, for local UI/UX QA.
 * Uso: bun --env-file=.env.local run scripts/seed-dev-member.ts
 */
import { prisma } from "../lib/db";
import { hashPassword } from "../lib/auth/password";

const EMAIL = "miembro.prueba@example.com";
const PASSWORD = "PruebaCurso2026!";

async function main() {
  const product = await prisma.product.findFirst({ where: { kind: "COURSE" } });
  if (!product) throw new Error("No course product found — run db:seed first");

  const contact = await prisma.contact.upsert({
    where: { phoneE164: "+10000000001" },
    update: { email: EMAIL, firstName: "Miembro", lastName: "Prueba" },
    create: {
      phoneE164: "+10000000001",
      email: EMAIL,
      firstName: "Miembro",
      lastName: "Prueba",
      source: "WEB",
    },
  });

  await prisma.memberAccount.upsert({
    where: { contactId: contact.id },
    update: { passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() },
    create: {
      contactId: contact.id,
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
    },
  });

  const existingEnrollment = await prisma.enrollment.findFirst({
    where: { contactId: contact.id, productId: product.id },
  });
  if (existingEnrollment) {
    await prisma.enrollment.update({
      where: { id: existingEnrollment.id },
      data: { status: "ACTIVE", paidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    });
  } else {
    await prisma.enrollment.create({
      data: {
        contactId: contact.id,
        productId: product.id,
        status: "ACTIVE",
        isPrimary: true,
        paidUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        paidAt: new Date(),
      },
    });
  }

  let mod = await prisma.courseModule.findFirst({ where: { productId: product.id } });
  if (!mod) {
    mod = await prisma.courseModule.create({
      data: {
        productId: product.id,
        title: "Módulo 1 · Fundamentos de PNL",
        bodyMd: "## Introducción\n\nContenido de bienvenida del módulo.",
        isPublished: true,
        sortOrder: 0,
      },
    });
  } else if (!mod.isPublished) {
    mod = await prisma.courseModule.update({
      where: { id: mod.id },
      data: { isPublished: true },
    });
  }

  const existingClass = await prisma.liveClassSession.findFirst({ where: { moduleId: mod.id } });
  if (!existingClass) {
    await prisma.liveClassSession.create({
      data: {
        productId: product.id,
        moduleId: mod.id,
        title: "Clase 1 · Anclajes y estados internos",
        description: "Introducción práctica a los anclajes.",
        recordingUrl: "https://drive.google.com/file/d/1a2b3c4d5e6f7g8h9i0j/view",
        recordingPostedAt: new Date(),
        sortOrder: 0,
      },
    });
  }

  console.log("Seeded test member:");
  console.log("  email:", EMAIL);
  console.log("  password:", PASSWORD);
  console.log("  productId:", product.id);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
