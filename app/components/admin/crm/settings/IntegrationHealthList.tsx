import { CheckCircle2, CircleSlash, TriangleAlert } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { getIntegrationBrand, SimpleIconGlyph } from "@/lib/integrations/brand";
import type { IntegrationHealth } from "@/lib/notifications/health";

/**
 * Fila de estado compartida entre el panel de Sistema y el de Pagos — ambos
 * son listas de `IntegrationHealth` (solo entorno), así que el renderizado es
 * idéntico y no debería divergir en dos copias.
 */
export const INTEGRATION_STATUS_META = {
  ok: { label: "Operativo", variant: "default" as const, Icon: CheckCircle2 },
  degraded: {
    label: "Degradado",
    variant: "destructive" as const,
    Icon: TriangleAlert,
  },
  not_configured: {
    label: "Sin configurar",
    variant: "secondary" as const,
    Icon: CircleSlash,
  },
};

const IntegrationHealthList = ({ items }: { items: IntegrationHealth[] }) => (
  <div className="divide-y divide-border">
    {items.map((item) => {
      const meta = INTEGRATION_STATUS_META[item.status];
      return (
        <div
          key={item.id}
          className="flex flex-wrap items-start justify-between gap-3 py-3"
        >
          <div className="flex min-w-0 gap-3">
            <SimpleIconGlyph
              visual={getIntegrationBrand(item)}
              className="mt-0.5 size-4 shrink-0"
            />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.detail}</p>
              {item.enables && (
                <p className="text-xs text-muted-foreground">{item.enables}</p>
              )}
              {item.status === "not_configured" &&
                item.requiredEnv.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Se activa al definir{" "}
                    {item.requiredEnv.map((name, i) => (
                      <span key={name}>
                        {i > 0 && ", "}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                          {name}
                        </code>
                      </span>
                    ))}
                    .
                  </p>
                )}
            </div>
          </div>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>
      );
    })}
  </div>
);

export default IntegrationHealthList;
