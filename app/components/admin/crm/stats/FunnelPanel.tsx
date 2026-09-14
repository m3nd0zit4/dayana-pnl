import type { FunnelStats } from "@/lib/crm/stats/dto";
import { CrmEmptyState } from "@/app/components/admin/crm/ui";
import KpiCard from "./KpiCard";
import FunnelCard from "./FunnelCard";
import BreakdownTable from "./BreakdownTable";
import AnswerDistribution from "./AnswerDistribution";

const formatCount = (value: number): string => value.toLocaleString("es-CO");

type Props = { data: FunnelStats };

/** Embudo del diagnóstico: de quién empieza a quién termina comprando. */
const FunnelPanel = ({ data }: Props) => {
  const isEmpty = (data.steps[0]?.count ?? 0) === 0;

  if (isEmpty) {
    return <CrmEmptyState title="Sin datos en este periodo" />;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Terminaron el diagnóstico" value={formatCount(data.completed.value)} kpi={data.completed} />
        {/* Aparte del embudo a propósito: se puede comprar sin pulsar
            «Hablar con Dayana» (un enlace de pago por WhatsApp), y como paso
            anidado esa compra no contaba. */}
        <KpiCard
          label="Compraron tras el diagnóstico"
          value={formatCount(data.purchased.value)}
          kpi={data.purchased}
          note={`De quienes terminaron, compra en los ${data.attributionDays} días siguientes, por cualquier camino`}
        />
      </div>

      <FunnelCard title="Recorrido del diagnóstico" steps={data.steps} />

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownTable title="Por fuente" rows={data.bySource} />
        <BreakdownTable title="Por perfil" rows={data.byProfile} />
      </div>

      <AnswerDistribution distribution={data.answerDistribution} />
    </div>
  );
};

export default FunnelPanel;
