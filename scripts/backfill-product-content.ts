/**
 * One-off: copia a la DB el contenido decorativo que antes vivía solo en el
 * mapa estático PLANS (unitPrice, tag, highlight, whatsappMessage,
 * therapyHeadline). Ejecutar ANTES de desplegar el código que elimina los
 * fallbacks estáticos.
 *
 * Solo rellena columnas vacías — no pisa ediciones hechas desde el CRM.
 * Uso: bun run scripts/backfill-product-content.ts [--dry-run]
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const loadEnv = () => {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
};
loadEnv();

import { prisma } from "../lib/db";
import { SEED_PLANS } from "../prisma/seed-data";

const dryRun = process.argv.includes("--dry-run");

const main = async () => {
  for (const plan of SEED_PLANS) {
    const product = await prisma.product.findUnique({
      where: { id: plan.id },
    });
    if (!product) {
      console.log(`— ${plan.id}: no existe en DB, se omite`);
      continue;
    }

    const data: Record<string, unknown> = {};
    if (product.unitPriceLabel == null && plan.unitPrice) {
      data.unitPriceLabel = plan.unitPrice;
    }
    if (product.tag == null && plan.tag) {
      data.tag = plan.tag;
    }
    if (!product.highlight && plan.highlight) {
      data.highlight = true;
    }
    if (product.whatsappMessage == null) {
      data.whatsappMessage = plan.whatsappMessage;
    }
    if (
      product.therapyHeadline == null &&
      plan.therapyPresentation?.sessionsHeadline
    ) {
      data.therapyHeadline = plan.therapyPresentation.sessionsHeadline;
    }

    if (Object.keys(data).length === 0) {
      console.log(`= ${plan.id}: nada que rellenar`);
      continue;
    }

    console.log(`+ ${plan.id}: ${Object.keys(data).join(", ")}`);
    if (!dryRun) {
      await prisma.product.update({ where: { id: plan.id }, data });
    }
  }

  console.log(dryRun ? "Dry run — sin cambios." : "Backfill completado.");
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
