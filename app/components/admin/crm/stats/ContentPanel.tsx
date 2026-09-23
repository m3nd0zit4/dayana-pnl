import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import type { ContentStats } from "@/lib/crm/stats/dto";
import type { StatsGranularity } from "@/lib/crm/stats/types";
import { DEFAULT_OPERATIONAL_TZ } from "@/lib/datetime/zoned-time";
import { CrmEmptyState } from "@/app/components/admin/crm/ui";
import KpiCard from "./KpiCard";
import SeriesChartCard from "./SeriesChartCard";
import BreakdownTable from "./BreakdownTable";

const formatCount = (value: number): string => value.toLocaleString("es-CO");

const formatPercent = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`;

// Zona operativa fija: este componente se pinta en el servidor (UTC en
// Vercel) y se hidrata en el navegador (Bogotá). Sin `timeZone`, una edición
// cerca de medianoche UTC mostraba un día distinto en cada lado.
const EDITION_DATE_FMT = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: DEFAULT_OPERATIONAL_TZ,
});

const formatEditionDate = (iso: string | null): string =>
  iso ? EDITION_DATE_FMT.format(new Date(iso)).replace(/\.(?=\s)/, "") : "Sin fecha";

type Props = { data: ContentStats; granularity: StatsGranularity };

/** Webinar, talleres y cursos: lo que se enseña y quién lo termina. */
const ContentPanel = ({ data, granularity }: Props) => {
  const isEmpty =
    data.webinar.registrations.value === 0 &&
    data.workshops.editions.length === 0 &&
    data.courses.classCompletions.value === 0;

  if (isEmpty) {
    return <CrmEmptyState title="Sin datos en este periodo" />;
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h2 className="text-sm font-medium">Eventos gratuitos</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Registros"
            value={formatCount(data.webinar.registrations.value)}
            kpi={data.webinar.registrations}
          />
          <KpiCard label="Fallos al enviar recordatorio" value={formatCount(data.webinar.reminderFailures)} />
          <KpiCard
            label="Registrados que compraron"
            value={formatCount(data.webinar.registrantsWhoPurchased)}
            note="Compra en los 60 días siguientes a registrarse, igual que en el embudo del diagnóstico"
          />
        </div>
        <SeriesChartCard
          title="Registros al webinar"
          points={data.webinar.registrationsSeries}
          granularity={granularity}
          seriesLabel="Registros"
        />
        <BreakdownTable title="Por edición" rows={data.webinar.byEdition} />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Talleres</h2>
        <Card>
          <CardHeader>
            <CardTitle>Cupos por edición</CardTitle>
            <CardDescription>Vendidos frente a capacidad</CardDescription>
          </CardHeader>
          <CardContent>
            {data.workshops.editions.length === 0 ? (
              <CrmEmptyState title="Sin datos en este periodo" className="py-6" />
            ) : (
              <ul className="space-y-2.5">
                {data.workshops.editions.map((ed) => {
                  const share = ed.capacity ? Math.min(1, ed.seatsSold / ed.capacity) : null;
                  return (
                    <li key={ed.key} className="space-y-1">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">
                          {ed.label}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {formatEditionDate(ed.startsAt)}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {ed.seatsSold.toLocaleString("es-CO")}
                          {ed.capacity !== null ? ` / ${ed.capacity.toLocaleString("es-CO")}` : ""}
                        </span>
                      </div>
                      {share !== null ? (
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.round(share * 100)}%` }}
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium">Curso</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Clases completadas"
            value={formatCount(data.courses.classCompletions.value)}
            kpi={data.courses.classCompletions}
          />
          <KpiCard label="Comentarios" value={formatCount(data.courses.comments.value)} kpi={data.courses.comments} />
          <KpiCard
            label="Aprobó el quiz"
            value={formatPercent(data.courses.quizPassRate)}
            note={`${formatCount(data.courses.quizAttempts)} intentos`}
          />
        </div>
        <SeriesChartCard
          title="Clases completadas"
          points={data.courses.completionsSeries}
          granularity={granularity}
          seriesLabel="Completadas"
        />
        <BreakdownTable title="Por módulo" rows={data.courses.moduleCompletion} />
      </section>
    </div>
  );
};

export default ContentPanel;
