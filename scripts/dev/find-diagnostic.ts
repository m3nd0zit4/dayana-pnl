/**
 * Devuelve el token de un diagnóstico ya completado, para abrir su página de
 * resultado sin volver a rellenar el cuestionario.
 *
 *   bunx tsx scripts/dev/find-diagnostic.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const row = await prisma.diagnostic.findFirst({
    where: { completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    select: { token: true, profile: true, recommendedProductId: true },
  });
  if (!row) {
    console.log("No hay ningún diagnóstico completado. Rellena el cuestionario primero.");
    return;
  }
  console.log(`Perfil:   ${row.profile}`);
  console.log(`Ofrecido: ${row.recommendedProductId}`);
  console.log(`URL:      /terapias/resultado/${row.token}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
