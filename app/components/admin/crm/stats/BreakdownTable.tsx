import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import { formatMoneyMinor } from "@/lib/crm/money";
import type { BreakdownRow } from "@/lib/crm/stats/dto";
import { CrmEmptyState } from "@/app/components/admin/crm/ui";

/** "42 %", o "—" sin proporción (grupo con total 0). */
const formatShare = (share: number | null): string =>
  share === null ? "—" : `${Math.round(share * 100).toLocaleString("es-CO")} %`;

const defaultValueFormatter = (row: BreakdownRow): string =>
  row.currency
    ? `${formatMoneyMinor(row.value, row.currency)} ${row.currency}`
    : row.value.toLocaleString("es-CO");

type RowsProps = {
  rows: BreakdownRow[];
  valueFormatter?: (row: BreakdownRow) => string;
};

/**
 * Solo las filas con su barra de proporción, sin título ni estado vacío —
 * la reutiliza `AnswerDistribution` para no repetir el marcado de la barra
 * por cada pregunta.
 */
export const BreakdownRowsList = ({ rows, valueFormatter = defaultValueFormatter }: RowsProps) => (
  <ul className="space-y-2.5">
    {rows.map((row) => (
      <li key={`${row.currency ?? ""}:${row.key}`} className="space-y-1">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate">{row.label}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {valueFormatter(row)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.round((row.share ?? 0) * 100)}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {formatShare(row.share)}
          </span>
        </div>
      </li>
    ))}
  </ul>
);

type Props = RowsProps & {
  title: string;
  description?: string;
  className?: string;
};

const BreakdownTable = ({ title, description, rows, valueFormatter, className }: Props) => (
  <Card className={className}>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      {description ? <CardDescription>{description}</CardDescription> : null}
    </CardHeader>
    <CardContent>
      {rows.length === 0 ? (
        <CrmEmptyState title="Sin datos en este periodo" className="py-6" />
      ) : (
        <BreakdownRowsList rows={rows} valueFormatter={valueFormatter} />
      )}
    </CardContent>
  </Card>
);

export default BreakdownTable;
