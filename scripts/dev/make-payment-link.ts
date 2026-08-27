/**
 * Crea un enlace de pago de prueba contra la DB de desarrollo.
 *
 *   bunx tsx scripts/dev/make-payment-link.ts [productId]
 *
 * Sólo para probar la página sin pasar por el panel. En producción los enlaces
 * se generan desde /admin/enlaces-pago, que además deja rastro de auditoría.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const productId = process.argv[2] ?? "therapy-6";
  const contact = await prisma.contact.findFirst({
    orderBy: { createdAt: "desc" },
  });
  if (!contact) {
    console.log("No hay ningún contacto en la base. Crea uno primero.");
    return;
  }

  const link = await prisma.paymentLink.create({
    data: {
      token: randomBytes(16).toString("hex"),
      contactId: contact.id,
      productId,
      note: "Lo que hablamos el martes.",
    },
  });

  console.log(`Contacto: ${contact.firstName} ${contact.lastName ?? ""}`.trim());
  console.log(`Producto: ${productId}`);
  console.log(`URL:      /pagar/${link.token}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
