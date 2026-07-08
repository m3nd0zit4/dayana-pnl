import ProductsPageClient from "@/app/components/admin/crm/ProductsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { listAllProducts } from "@/lib/crm/products-admin";
import { resolveUsdToCopRate } from "@/lib/crm/site-settings";

export const dynamic = "force-dynamic";

const ProductsPage = async () => {
  const preview = isCrmUiPreview();
  if (preview) {
    return <ProductsPageClient preview initialProducts={[]} usdToCopRate={3500} />;
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const [products, usdToCopRate] = await Promise.all([
    listAllProducts(),
    resolveUsdToCopRate(),
  ]);

  return (
    <ProductsPageClient
      preview={false}
      usdToCopRate={usdToCopRate}
      initialProducts={products.map((p) => ({
        id: p.id,
        kind: p.kind,
        title: p.title,
        sessionsLabel: p.sessionsLabel,
        sessionsCount: p.sessionsCount,
        description: p.description,
        isActive: p.isActive,
        sortOrder: p.sortOrder,
        prices: p.prices.map((price) => ({
          currency: price.currency,
          amountMinor: price.amountMinor,
          listAmountMinor: price.listAmountMinor,
        })),
      }))}
    />
  );
};

export default ProductsPage;
