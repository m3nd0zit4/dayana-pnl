"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import CrmSegmentedControl from "@/app/components/admin/crm/CrmSegmentedControl";
import { CrmErrorState } from "@/app/components/admin/crm/ui";
import { statsRangeToSearchParams } from "@/lib/crm/stats/range";
import type { SerializableStatsRange, StatsPayload } from "@/lib/crm/stats/dto";
import type { StatsArea } from "@/lib/crm/stats/types";
import PeriodPicker, { type PeriodChange } from "./PeriodPicker";
import SalesPanel from "./SalesPanel";
import FunnelPanel from "./FunnelPanel";
import PeoplePanel from "./PeoplePanel";
import ContentPanel from "./ContentPanel";

const AREA_SEGMENTS = [
  { id: "ventas", label: "Ventas" },
  { id: "embudo", label: "Embudo del diagnóstico" },
  { id: "contactos", label: "Contactos y membresías" },
  { id: "contenido", label: "Webinar, talleres y cursos" },
] as const satisfies readonly { id: StatsArea; label: string }[];

const DATE_LABEL_FMT = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "14 sep 2026", sin el punto que deja `Intl` tras el mes abreviado. */
const formatDateKeyLabel = (key: string): string => {
  const [year, month, day] = key.split("-").map(Number);
  return DATE_LABEL_FMT.format(new Date(Date.UTC(year, month - 1, day))).replace(/\.(?=\s)/, "");
};

type Props = {
  payload: StatsPayload;
  range: SerializableStatsRange;
  /** Presente cuando la consulta del área activa falló: se pinta en vez del panel. */
  error?: string;
};

/**
 * Página de Estadísticas: cabecera con área + periodo, y el panel del área
 * activa. La URL es el único estado (patrón Plausible) — cambiar de área o de
 * periodo hace `router.push` con los search params combinados, así que
 * recargar o compartir el enlace reproduce exactamente la misma vista.
 */
const StatsPageClient = ({ payload, range, error }: Props) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const pushParams = (next: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["area", "period", "from", "to"]) params.delete(key);
    for (const [key, value] of Object.entries(next)) params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleAreaChange = (area: StatsArea) => {
    pushParams({ area, ...statsRangeToSearchParams(range) });
  };

  const handlePeriodChange = (change: PeriodChange) => {
    const next: Record<string, string> = { area: payload.area, period: change.period };
    if (change.period === "custom") {
      next.from = change.from ?? range.fromKey;
      next.to = change.to ?? range.toKey;
    }
    pushParams(next);
  };

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Estadísticas"
        description={`Periodo: ${formatDateKeyLabel(range.fromKey)} – ${formatDateKeyLabel(range.toKey)} · comparado con el periodo anterior`}
        trailing={
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="-mx-1 overflow-x-auto px-1">
              <CrmSegmentedControl
                segments={AREA_SEGMENTS}
                value={payload.area}
                onChange={handleAreaChange}
                aria-label="Área de Estadísticas"
              />
            </div>
            <PeriodPicker
              period={range.period}
              fromKey={range.fromKey}
              toKey={range.toKey}
              onChange={handlePeriodChange}
            />
          </div>
        }
      />
      {error ? (
        <CrmErrorState message={error} title="No se pudieron cargar las estadísticas" />
      ) : payload.area === "ventas" ? (
        <SalesPanel data={payload.data} granularity={range.granularity} />
      ) : payload.area === "embudo" ? (
        <FunnelPanel data={payload.data} />
      ) : payload.area === "contactos" ? (
        <PeoplePanel data={payload.data} granularity={range.granularity} />
      ) : (
        <ContentPanel data={payload.data} granularity={range.granularity} />
      )}
    </CrmPageShell>
  );
};

export default StatsPageClient;
