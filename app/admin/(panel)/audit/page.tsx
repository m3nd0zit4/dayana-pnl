import AuditPageClient from "@/app/components/admin/crm/AuditPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";

export const dynamic = "force-dynamic";

const AuditPage = () => {
  const preview = isCrmUiPreview();
  return <AuditPageClient preview={preview} />;
};

export default AuditPage;
