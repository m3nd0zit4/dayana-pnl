import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import { CrmLoadingState } from "@/app/components/admin/crm/ui";

const CostosLoading = () => (
  <CrmPageShell>
    <CrmPageHeader title="Costos" />
    <CrmLoadingState variant="card" rows={4} />
  </CrmPageShell>
);

export default CostosLoading;
