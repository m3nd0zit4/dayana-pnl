import { prisma } from "../lib/db";

const main = async () => {
  await prisma.$queryRaw`SELECT 1`;
  const [contacts, staff, products, workshops] = await Promise.all([
    prisma.contact.count(),
    prisma.staffUser.count(),
    prisma.product.count(),
    prisma.workshopEdition.count(),
  ]);
  console.log(
    JSON.stringify({
      connected: true,
      contacts,
      staff,
      products,
      workshops,
    })
  );
};

main()
  .catch((e) => {
    console.error("DB_ERROR", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
