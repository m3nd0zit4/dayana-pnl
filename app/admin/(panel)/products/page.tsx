import ProductsPageClient from "@/app/components/admin/crm/ProductsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { listSellableProducts } from "@/lib/crm/products-admin";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

const ProductsPage = async () => {
  const siteUrl = getSiteUrl();
  const preview = isCrmUiPreview();
  if (preview) {
    return <ProductsPageClient preview initialProducts={[]} siteUrl={siteUrl} />;
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const products = await listSellableProducts();

  return (
    <ProductsPageClient
      preview={false}
      siteUrl={siteUrl}
      initialProducts={products.map((p) => ({
        id: p.id,
        kind: p.kind,
        title: p.title,
        imageUrl: p.imageUrl,
        sessionsLabel: p.sessionsLabel,
        sessionsCount: p.sessionsCount,
        description: p.description,
        tag: p.tag,
        highlight: p.highlight,
        unitPriceLabel: p.unitPriceLabel,
        therapyHeadline: p.therapyHeadline,
        accent: p.accent,
        whatsappMessage: p.whatsappMessage,
        isActive: p.isActive,
        sortOrder: p.sortOrder,
        // Sin esto la primera pintura no sabía si el producto lleva plan
        // recurrente, y el aviso de sincronización de precio sólo aparecía
        // tras el primer refetch del cliente.
        paypalPlanId: p.paypalPlanId,
        mercadoPagoPreapprovalPlanId: p.mercadoPagoPreapprovalPlanId,
        priceSyncStatus: p.priceSyncStatus,
        priceSyncNote: p.priceSyncNote,
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
