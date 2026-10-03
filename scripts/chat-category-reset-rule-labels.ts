/**
 * Una sola vez: borra las etiquetas «personal» / «negocio» que pusieron las
 * REGLAS VIEJAS (antes de la revisión, commit 90a4297): la libreta del
 * celular, respuestas automáticas, publicidad, enlaces, perfiles de marca y
 * comprobantes reenviados podían quedar como «personal» o «negocio» y
 * silenciar a una clienta en B2. Esos chats quedan sin clasificar y
 * pendientes: la próxima tanda los vuelve a decidir con las reglas de ahora
 * (los códigos de verificación vuelven a «negocio» solos).
 *
 *   bun scripts/chat-category-reset-rule-labels.ts --dry-run   cuenta y enseña, no escribe
 *   bun scripts/chat-category-reset-rule-labels.ts --apply     borra
 *
 * Solo toca `category_source = 'rule'` con categoría personal o negocio;
 * nunca lo manual ni lo de la IA. Contra una base cuyo nombre no lleva «dev»
 * pide además `--i-know-prod`. En producción no debería haber nada: allí
 * nunca corrieron las reglas viejas (la migración llegó después).
 *
 * El SQL equivalente, por si se prefiere a mano:
 *   UPDATE conversations SET category = NULL, category_source = NULL,
 *     category_confidence = NULL, category_reason = NULL, category_review = false,
 *     categorized_at = NULL, categorized_through_at = NULL
 *   WHERE category_source = 'rule' AND category IN ('personal', 'negocio');
 */
import { prisma } from "@/lib/db";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DRY = args.includes("--dry-run");
if (APPLY === DRY) {
  console.error("Indica --dry-run (solo cuenta) o --apply (borra).");
  process.exit(2);
}

const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const target = url ? `${url.hostname}${url.pathname}` : "(DATABASE_URL no válida)";
if (APPLY && !url?.pathname.toLowerCase().includes("dev") && !args.includes("--i-know-prod")) {
  console.error(`--apply contra ${target}, que no parece de desarrollo: añade --i-know-prod si de verdad quieres.`);
  process.exit(2);
}

const where = { channel: "WHATSAPP" as const, categorySource: "rule", category: { in: ["personal", "negocio"] } };

const main = async () => {
  const rows = await prisma.conversation.groupBy({
    by: ["category", "categoryReason"],
    where,
    _count: { _all: true },
  });
  const total = rows.reduce((a, r) => a + r._count._all, 0);
  console.log(`Base: ${target} · etiquetas de regla personal/negocio: ${total}`);
  for (const r of rows.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${String(r._count._all).padStart(4)}  ${r.category} · ${r.categoryReason ?? "(sin motivo)"}`);
  }
  if (!APPLY) {
    console.log("\nNo se escribió nada. Para borrarlas: --apply.");
    return;
  }
  const r = await prisma.conversation.updateMany({
    where,
    data: {
      category: null,
      categorySource: null,
      categoryConfidence: null,
      categoryReason: null,
      categoryReview: false,
      categorizedAt: null,
      categorizedThroughAt: null,
    },
  });
  console.log(`\nBorradas: ${r.count}. Quedan pendientes para la próxima tanda.`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
