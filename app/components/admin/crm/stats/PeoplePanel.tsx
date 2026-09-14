import type { PeopleStats } from "@/lib/crm/stats/dto";
import type { StatsGranularity } from "@/lib/crm/stats/types";
import { CrmEmptyState } from "@/app/components/admin/crm/ui";
import KpiCard from "./KpiCard";
import SeriesChartCard from "./SeriesChartCard";
import BreakdownTable from "./BreakdownTable";

const formatCount = (value: number): string => value.toLocaleString("es-CO");

const formatPercent = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`;

type Props = { data: PeopleStats; granularity: StatsGranularity };

/** Contactos y membresías: quién llega, quién se queda y quién se va. */
const PeoplePanel = ({ data, granularity }: Props) => {
  const isEmpty =
    data.newContacts.value === 0 && data.members.active === 0 && data.pipeline.length === 0;

  if (isEmpty) {
    return <CrmEmptyState title="Sin datos en este periodo" />;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Contactos nuevos" value={formatCount(data.newContacts.value)} kpi={data.newContacts} />
        <KpiCard
          label="Miembros pagos nuevos"
          value={formatCount(data.newPaidMembers.value)}
          kpi={data.newPaidMembers}
        />
        <KpiCard label="Renovaciones" value={formatCount(data.renewals.value)} kpi={data.renewals} />
        <KpiCard
          label="Con consentimiento de marketing"
          value={formatPercent(data.marketingConsentRate)}
          note="De los contactos nuevos del periodo"
        />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium">Membresías hoy</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <KpiCard label="Activas" value={formatCount(data.members.active)} />
          <KpiCard label="Vencen esta semana" value={formatCount(data.members.expiringThisWeek)} />
          <KpiCard label="Vencidas" value={formatCount(data.members.expired)} />
        </div>
      </div>

      <SeriesChartCard
        title="Contactos nuevos"
        points={data.newContactsSeries}
        granularity={granularity}
        seriesLabel="Contactos"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownTable title="Por fuente" rows={data.contactsBySource} />
        <BreakdownTable title="Por país" rows={data.contactsByCountry} />
        <BreakdownTable title="Suscripciones por estado" rows={data.subscriptionsByStatus} />
        <BreakdownTable title="Suscripciones por pasarela" rows={data.subscriptionsByProvider} />
      </div>

      <BreakdownTable
        title="Pipeline de inscripciones"
        description="Estado actual de todas las inscripciones"
        rows={data.pipeline}
      />
    </div>
  );
};

export default PeoplePanel;
