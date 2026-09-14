import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import { CrmLoadingState } from "@/app/components/admin/crm/ui";

const EstadisticasLoading = () => (
  <CrmPageShell>
    <CrmPageHeader title="Estadísticas" />
    <CrmLoadingState variant="card" rows={4} />
  </CrmPageShell>
);

export default EstadisticasLoading;
