import { Card, CardContent } from "@/app/components/ui/card";
import type { FunnelStats } from "@/lib/crm/call-funnel/server";

/**
 * Los números del embudo de la llamada gratis, en una tira que se parte sola en
 * el teléfono: cuántas personas llegaron a cada paso y qué parte del paso
 * anterior es. Sin gráficas: son cinco números y se leen mejor como números.
 *
 * «Hablaron» se compara con «Agendaron» y no con «Confirmaron»: se puede hablar
 * sin haber confirmado, y comparado con las que confirmaron saldría más del
 * 100 %.
 */

const count = (n: number) => n.toLocaleString("es-CO");

/** «62 %» o «—» cuando no hay de dónde sacar el porcentaje. */
const share = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 100)} %` : "—");

type Step = { label: string; value: number; of: { value: number; label: string } | null };

const stepsOf = (stats: FunnelStats): Step[] => [
  { label: "Dejaron sus datos", value: stats.leads, of: null },
  { label: "Respondieron", value: stats.answered, of: { value: stats.leads, label: "de quienes dejaron sus datos" } },
  { label: "Agendaron", value: stats.booked, of: { value: stats.answered, label: "de quienes respondieron" } },
  { label: "Confirmaron", value: stats.confirmed, of: { value: stats.booked, label: "de quienes agendaron" } },
  { label: "Hablaron", value: stats.talked, of: { value: stats.booked, label: "de quienes agendaron" } },
];

const FunnelSummary = ({
  stats,
  toFollowUp,
}: {
  stats: FunnelStats;
  /** Con el seguimiento al día de esta pantalla (cambia al marcar una fila). */
  toFollowUp: number;
}) => (
  <Card>
    <CardContent className="space-y-4">
      <ol aria-label="Pasos del embudo" className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        {stepsOf(stats).map((step) => (
          <li key={step.label} className="min-w-0">
            <p className="text-xs text-muted-foreground">{step.label}</p>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">{count(step.value)}</p>
            {step.of ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">{share(step.value, step.of.value)}</span>{" "}
                {step.of.value > 0 ? step.of.label : ""}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      <p className="text-sm">
        Por hacer seguimiento: <span className="font-semibold tabular-nums">{count(toFollowUp)}</span>
        {stats.noAnswer > 0 ? (
          <span className="text-muted-foreground">
            {" "}
            · No contestaron la llamada: <span className="tabular-nums">{count(stats.noAnswer)}</span>
          </span>
        ) : null}
      </p>

      {stats.byChannel.length > 0 ? (
        <div className="space-y-1.5 border-t border-border pt-4">
          <h2 className="text-sm font-medium">De dónde llegaron</h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {stats.byChannel.map((c) => (
              <li key={c.channel}>
                <span className="font-medium">{c.label}</span>{" "}
                <span className="text-muted-foreground">
                  · <span className="tabular-nums">{count(c.leads)}</span> {c.leads === 1 ? "llegó" : "llegaron"} ·{" "}
                  <span className="tabular-nums">{count(c.booked)}</span> {c.booked === 1 ? "agendó" : "agendaron"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </CardContent>
  </Card>
);

export default FunnelSummary;
