import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import type { AnswerDistribution as AnswerDistributionDto } from "@/lib/crm/stats/dto";
import { CrmEmptyState } from "@/app/components/admin/crm/ui";
import { BreakdownRowsList } from "./BreakdownTable";

type Props = {
  distribution: AnswerDistributionDto[];
  className?: string;
};

/**
 * Una tarjeta por pregunta del diagnóstico, con sus opciones y cuántas
 * personas eligió cada una — para ver de qué habla la gente que llega, no
 * solo cuánta llega.
 */
const AnswerDistribution = ({ distribution, className }: Props) => (
  <Card className={className}>
    <CardHeader>
      <CardTitle>Respuestas del diagnóstico</CardTitle>
    </CardHeader>
    <CardContent>
      {distribution.length === 0 ? (
        <CrmEmptyState title="Sin datos en este periodo" className="py-6" />
      ) : (
        <div className="space-y-6">
          {distribution.map((q) => (
            <div key={q.questionId} className="space-y-2">
              <h3 className="text-sm font-medium">{q.question}</h3>
              {q.options.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin respuestas.</p>
              ) : (
                <BreakdownRowsList rows={q.options} />
              )}
            </div>
          ))}
        </div>
      )}
    </CardContent>
  </Card>
);

export default AnswerDistribution;
