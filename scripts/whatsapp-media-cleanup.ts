/**
 * Limpieza de fotos, audios y videos viejos del store de Blob.
 *
 *   bun scripts/whatsapp-media-cleanup.ts                 (en seco: solo cuenta)
 *   bun scripts/whatsapp-media-cleanup.ts --days 60       (otro corte; por defecto el de Ajustes)
 *   bun scripts/whatsapp-media-cleanup.ts --apply         (borra de verdad)
 *   bun scripts/whatsapp-media-cleanup.ts --usage         (cuánto ocupa cada carpeta del store)
 *
 * Contra la base a la que apunte DATABASE_URL. Borrar en producción solo con
 * el OK de la dueña. Qué se borra y qué no: `lib/crm/whatsapp-agent/media-cleanup-rules.ts`.
 */
import { prisma } from "@/lib/db";
import { blobUsageByFolder, cleanHistoryParts, cleanOldMedia } from "@/lib/crm/whatsapp-agent/media-cleanup";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const daysArg = args.indexOf("--days");
const keepDays = daysArg >= 0 ? Number(args[daysArg + 1]) : undefined;
if (keepDays !== undefined && (!Number.isInteger(keepDays) || keepDays < 14)) {
  throw new Error("--days tiene que ser un número entero de 14 o más.");
}

const main = async () => {
  if (args.includes("--usage")) {
    console.table(await blobUsageByFolder());
    return;
  }
  const result = await cleanOldMedia({ budgetMs: 10 * 60_000, dryRun: !apply, keepDays, batch: 200 });
  console.log(
    `${apply ? "Borrados" : "Se borrarían (en seco)"}: ${result.files} archivos en ${result.messages} mensajes de más de ${result.keepDays} días`,
    result.byKind
  );
  if (result.error) {
    console.error(`Blob no dejó borrar: ${result.error}`);
    process.exit(1);
  }
  const parts = await cleanHistoryParts({ dryRun: !apply });
  console.log(`Partes de historiales ya procesados: ${parts.files} (${Math.round(parts.bytes / 1e6)} MB)${parts.error ? ` · error: ${parts.error}` : ""}`);
  if (!apply) console.log("Para borrar de verdad: --apply");
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
