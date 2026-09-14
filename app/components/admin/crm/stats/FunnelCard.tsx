import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/components/ui/card";
import type { FunnelStep } from "@/lib/crm/stats/dto";
import { CrmEmptyState } from "@/app/components/admin/crm/ui";

/** "42 %", o "—" sin conversión (primer paso, o paso anterior en 0). */
const formatConversion = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value * 100).toLocaleString("es-CO")} %`;

type Props = {
  title: string;
  description?: string;
  steps: FunnelStep[];
  className?: string;
};

/**
 * Embudo con barras horizontales proporcionales al primer paso: se ve de un
 * vistazo dónde se pierde la mayoría, sin tener que leer los números uno a
 * uno. La conversión mostrada es siempre "desde el paso anterior" — la que
 * responde "¿qué % de los de aquí siguió al siguiente paso?".
 */
const FunnelCard = ({ title, description, steps, className }: Props) => {
  const first = steps[0]?.count ?? 0;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {steps.length === 0 || first === 0 ? (
          <CrmEmptyState title="Sin datos en este periodo" className="py-6" />
        ) : (
          <ul className="space-y-3">
            {steps.map((step) => (
              <li key={step.key} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{step.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {step.count.toLocaleString("es-CO")}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {formatConversion(step.conversionFromPrevious)}
                    </span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.round((step.count / first) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

export default FunnelCard;
