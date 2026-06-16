import PaymentsPageClient from "@/app/components/admin/crm/PaymentsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";

export const dynamic = "force-dynamic";

const PaymentsPage = () => <PaymentsPageClient preview={isCrmUiPreview()} />;

export default PaymentsPage;
