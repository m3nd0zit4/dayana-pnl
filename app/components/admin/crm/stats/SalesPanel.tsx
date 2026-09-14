import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { formatMoneyMinor } from "@/lib/crm/money";
import { withDelta } from "@/lib/crm/stats/kpi";
import type { SalesStats } from "@/lib/crm/stats/dto";
import type { StatsGranularity } from "@/lib/crm/stats/types";
import { CrmEmptyState } from "@/app/components/admin/crm/ui";
import KpiCard from "./KpiCard";
import SeriesChartCard from "./SeriesChartCard";
import BreakdownTable from "./BreakdownTable";
import FunnelCard from "./FunnelCard";

const formatPercent = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`;

const formatCount = (value: number): string => value.toLocaleString("es-CO");

type Props = { data: SalesStats; granularity: StatsGranularity };

/** Ventas e ingresos: lo que entró, lo que falló y de dónde vino cada cobro. */
const SalesPanel = ({ data, granularity }: Props) => {
  const isEmpty = data.approvedCount.value === 0 && data.revenue.every((r) => r.kpi.value === 0);

  const failureKpi =
    data.failureRate.value !== null && data.failureRate.previous !== null
      ? withDelta(data.failureRate.value, data.failureRate.previous)
      : null;

  if (isEmpty) {
    return <CrmEmptyState title="Sin datos en este periodo" />;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.revenue.map((r) => (
          <KpiCard
            key={`revenue-${r.currency}`}
            label={`Ingresos (${r.currency})`}
            value={`${formatMoneyMinor(r.kpi.value, r.currency)} ${r.currency}`}
            kpi={r.kpi}
          />
        ))}
        <KpiCard
          label="Pagos aprobados"
          value={formatCount(data.approvedCount.value)}
          kpi={data.approvedCount}
        />
        {data.averageTicket.map((t) => (
          <KpiCard
            key={`ticket-${t.currency}`}
            label={`Ticket promedio (${t.currency})`}
            value={t.valueMinor === null ? "—" : `${formatMoneyMinor(t.valueMinor, t.currency)} ${t.currency}`}
          />
        ))}
        <KpiCard
          label="Tasa de fallo"
          value={formatPercent(data.failureRate.value)}
          kpi={failureKpi}
          note="FAILED / (APROBADOS + FAILED)"
        />
      </div>

      <SeriesChartCard
        title="Ingresos · equivalente USD"
        description={`Pagos aprobados, COP convertido a ${data.usdToCopRate.toLocaleString("es-CO")} por dólar`}
        points={data.usdEquivalentSeries}
        granularity={granularity}
        seriesLabel="USD equiv."
        valueFormatter={(v) => `$${v.toLocaleString("es-CO", { maximumFractionDigits: 0 })}`}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {data.seriesByCurrency.map((s) => (
          <SeriesChartCard
            key={s.currency}
            title={`Ingresos (${s.currency})`}
            points={s.points}
            granularity={granularity}
            seriesLabel={s.currency}
            valueFormatter={(v) => formatMoneyMinor(v, s.currency)}
            color={s.currency === "USD" ? "var(--chart-2)" : "var(--chart-1)"}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownTable title="Por paquete" rows={data.byProduct} />
        <BreakdownTable title="Por pasarela" rows={data.byProvider} />
        <BreakdownTable title="Por país de quien paga" rows={data.byCountry} />
        <BreakdownTable
          title="Motivos de fallo más frecuentes"
          rows={data.topFailureCodes}
        />
      </div>

      <FunnelCard
        title="Enlaces de pago"
        description="Creados → abiertos → empezaron a pagar → pagados"
        steps={data.paymentLinks}
      />

      <Card>
        <CardHeader>
          <CardTitle>Códigos promocionales</CardTitle>
          <CardDescription>Canjes y descuento otorgado en el periodo</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-6">
          <div>
            <p className="text-sm text-muted-foreground">Canjes</p>
            <p className="text-xl font-semibold tabular-nums">
              {formatCount(data.promo.redemptions.value)}
            </p>
          </div>
          {data.promo.discountByCurrency.map((d) => (
            <div key={d.currency}>
              <p className="text-sm text-muted-foreground">Descuento ({d.currency})</p>
              <p className="text-xl font-semibold tabular-nums">
                {formatMoneyMinor(d.minor, d.currency)} {d.currency}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {data.paymentsWithoutFee} pago(s) sin comisión conocida (p. ej. manuales) ·{" "}
        {data.refundedFromPeriod} pago(s) del periodo hoy reembolsados · tasa USD→COP usada:{" "}
        {data.usdToCopRate.toLocaleString("es-CO")}.
      </p>
    </div>
  );
};

export default SalesPanel;
