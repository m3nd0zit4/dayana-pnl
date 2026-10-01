/**
 * El cupo previsto del evento gratuito se guarda. Antes `capacity` se metía en
 * los datos DESPUÉS del update y nunca llegaba a la base: el panel lo mostraba
 * hasta recargar y volvía al valor viejo.
 *
 * Contra la base de DESARROLLO; deja el cupo como estaba.
 *
 *   bun scripts/free-webinar-capacity-e2e.ts
 */
import { prisma } from "@/lib/db";
import {
  ensureFreeWebinar,
  FREE_WEBINAR_SLUG,
  updateFreeWebinar,
} from "@/lib/crm/free-webinar";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");

const readCapacity = async () =>
  (
    await prisma.freeWebinar.findUniqueOrThrow({
      where: { slug: FREE_WEBINAR_SLUG },
      select: { capacity: true },
    })
  ).capacity;

const main = async () => {
  await ensureFreeWebinar();
  const before = await readCapacity();
  const target = before === 137 ? 138 : 137;

  let ok = false;
  try {
    const { webinar } = await updateFreeWebinar({ capacity: target });
    const saved = await readCapacity();
    console.log(`cupo: antes ${before} → pedido ${target} → devuelto ${webinar.capacity} → en base ${saved}`);
    ok = saved === target && webinar.capacity === target;
  } finally {
    await prisma.freeWebinar.update({
      where: { slug: FREE_WEBINAR_SLUG },
      data: { capacity: before },
    });
  }

  console.log(ok ? "\n✅ OK" : "\n❌ FALLÓ");
  process.exit(ok ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
