import PaymentLinksPageClient, {
  type PaymentLinkListRow,
} from "@/app/components/admin/crm/PaymentLinksPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { listRecentPaymentLinks } from "@/lib/crm/payment-links";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

const EnlacesPagoPage = async () => {
  const siteUrl = getSiteUrl();
  const preview = isCrmUiPreview();
  if (preview) {
    return (
      <PaymentLinksPageClient preview initialLinks={[]} siteUrl={siteUrl} />
    );
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const rows = await listRecentPaymentLinks();
  const links: PaymentLinkListRow[] = rows.map((l) => ({
    id: l.id,
    token: l.token,
    note: l.note,
    expiresAt: l.expiresAt?.toISOString() ?? null,
    openedAt: l.openedAt?.toISOString() ?? null,
    checkoutStartedAt: l.checkoutStartedAt?.toISOString() ?? null,
    revokedAt: l.revokedAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    product: l.product,
    contact: l.contact,
  }));

  return (
    <PaymentLinksPageClient
      preview={false}
      initialLinks={links}
      siteUrl={siteUrl}
    />
  );
};

export default EnlacesPagoPage;
