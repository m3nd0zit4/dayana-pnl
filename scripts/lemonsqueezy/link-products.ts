/**
 * Vincula el catálogo del CRM con los productos YA creados en Lemon Squeezy.
 *
 *   bunx tsx scripts/lemonsqueezy/link-products.ts --dry-run
 *   bunx tsx scripts/lemonsqueezy/link-products.ts
 *
 * Por qué vincular y no crear: la API de Lemon Squeezy es de SOLO LECTURA para
 * products y variants (`POST /v1/products` → 405). El catálogo se crea a mano
 * en el dashboard; este script sólo lee las variantes y escribe sus ids en
 * `Product.lemonSqueezyVariantId`.
 *
 * Emparejamiento: primero por título EXACTO (normalizado sin acentos ni
 * mayúsculas) contra `Product.title`, y como respaldo por un sufijo
 * "[plan-id]" en el nombre. Se prefiere el título porque el nombre del producto
 * de LS es lo que ve el cliente en el checkout y en el recibo — un sufijo
 * "[therapy-1]" ahí queda feo.
 */
import { prisma } from "../../lib/db";
import { getActiveProducts } from "../../lib/crm/products";
import {
  lemonSqueezyRequest,
  lemonSqueezyStoreId,
} from "../../lib/payments/lemonsqueezy/client";

const DRY_RUN = process.argv.includes("--dry-run");
const SUBSCRIPTION_PRODUCT_IDS = new Set(["course-live"]);

type LsProduct = {
  id?: string;
  attributes?: { name?: string; status?: string };
};
type LsVariant = {
  id?: string;
  attributes?: {
    name?: string;
    price?: number;
    is_subscription?: boolean;
    status?: string;
    product_id?: number;
  };
};

/** Sin acentos, sin mayusculas, sin espacios de mas. */
const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/s+/g, " ")
    .trim();

const log = (...a: unknown[]) => console.log("[ls:link]", ...a);

/** Extrae `plan-id` de "Título [plan-id]". */
const planIdFromName = (name: string): string | null => {
  const m = name.match(/\[([a-z0-9-]+)\]\s*$/i);
  return m ? m[1].toLowerCase() : null;
};

async function main() {
  const storeId = lemonSqueezyStoreId();
  if (!storeId) throw new Error("LEMONSQUEEZY_STORE_ID no está configurado");

  const products = await lemonSqueezyRequest<{ data?: LsProduct[] }>(
    `/products?filter[store_id]=${storeId}&page[size]=100`
  );
  const variants = await lemonSqueezyRequest<{ data?: LsVariant[] }>(
    `/variants?page[size]=100`
  );

  const lsProducts = products.data ?? [];
  const lsVariants = variants.data ?? [];
  log(`${lsProducts.length} productos y ${lsVariants.length} variantes en LS`);

  const plans = await getActiveProducts();
  const rows: Array<Record<string, string>> = [];
  const problems: string[] = [];

  for (const plan of plans) {
    const match =
      lsProducts.find(
        (p) => norm(p.attributes?.name ?? "") === norm(plan.title)
      ) ??
      lsProducts.find(
        (p) => planIdFromName(p.attributes?.name ?? "") === plan.id
      );
    if (!match?.id) {
      problems.push(
        `${plan.id}: sin producto en LS llamado "${plan.title}" (ni con "[${plan.id}]")`
      );
      continue;
    }

    const own = lsVariants.filter(
      (v) => String(v.attributes?.product_id ?? "") === String(match.id)
    );
    // LS crea una variante "Default" al publicar; si hay varias, se toma la
    // primera publicada para no dejar el checkout con un selector.
    const variant = own.find((v) => v.attributes?.status !== "draft") ?? own[0];
    if (!variant?.id) {
      problems.push(`${plan.id}: el producto existe pero no tiene variantes`);
      continue;
    }

    const wantsSubscription = SUBSCRIPTION_PRODUCT_IDS.has(plan.id);
    const isSubscription = variant.attributes?.is_subscription === true;
    if (wantsSubscription !== isSubscription) {
      problems.push(
        `${plan.id}: se esperaba ${wantsSubscription ? "suscripción" : "pago único"} ` +
          `pero la variante es ${isSubscription ? "suscripción" : "pago único"}`
      );
      continue;
    }

    rows.push({
      plan: plan.id,
      producto: match.attributes?.name ?? "—",
      variante: variant.id,
      tipo: isSubscription ? "suscripción" : "pago único",
      "precio LS": String((variant.attributes?.price ?? 0) / 100),
    });

    if (!DRY_RUN) {
      await prisma.product.update({
        where: { id: plan.id },
        data: {
          lemonSqueezyProductId: match.id,
          lemonSqueezyVariantId: variant.id,
          lemonSqueezySubscription: isSubscription,
        },
      });
    }
  }

  if (rows.length) console.table(rows);
  if (problems.length) {
    console.log("\nPendientes:");
    for (const p of problems) console.log("  ·", p);
  }
  console.log(
    DRY_RUN
      ? "\nDRY RUN: no se escribió nada en la base de datos."
      : `\n${rows.length} plan(es) vinculados.`
  );
}

main()
  .catch((e) => {
    console.error("[ls:link] falló", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
