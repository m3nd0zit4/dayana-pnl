import PromoCodesPageClient from "@/app/components/admin/crm/PromoCodesPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { listAllPromoCodes } from "@/lib/crm/promo-codes-admin";

export const dynamic = "force-dynamic";

const PromoCodesPage = async () => {
  const preview = isCrmUiPreview();
  if (preview) {
    return <PromoCodesPageClient preview initialPromoCodes={[]} />;
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const promoCodes = await listAllPromoCodes();

  return (
    <PromoCodesPageClient
      preview={false}
      initialPromoCodes={promoCodes.map((p) => ({
        id: p.id,
        code: p.code,
        description: p.description,
        discountType: p.discountType,
        percentOff: p.percentOff,
        amountOffUsdMinor: p.amountOffUsdMinor,
        amountOffCopMinor: p.amountOffCopMinor,
        isActive: p.isActive,
        maxRedemptions: p.maxRedemptions,
        timesRedeemed: p.timesRedeemed,
        expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
        products: p.products.map((link) => ({
          id: link.product.id,
          title: link.product.title,
        })),
      }))}
    />
  );
};

export default PromoCodesPage;
