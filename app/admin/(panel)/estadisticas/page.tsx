import { redirect } from "next/navigation";
import StatsPageClient from "@/app/components/admin/crm/stats/StatsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { OPERATIONAL_TZ, getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { serializeStatsRange, type StatsPayload } from "@/lib/crm/stats/dto";
import { getSalesStats } from "@/lib/crm/stats/sales";
import { getFunnelStats } from "@/lib/crm/stats/funnel";
import { getPeopleStats } from "@/lib/crm/stats/people";
import { getContentStats } from "@/lib/crm/stats/content";
import { PREVIEW_STATS } from "@/lib/crm/stats/preview";
import { parseStatsArea, parseStatsRange } from "@/lib/crm/stats/range";
import type { StatsArea, StatsRange } from "@/lib/crm/stats/types";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  area?: string | string[];
  period?: string | string[];
  from?: string | string[];
  to?: string | string[];
}>;

type Props = { searchParams: SearchParams };

/** Solo el área activa hace su consulta — pedir las cuatro por visita sería tres veces el trabajo para tres pestañas que nadie está mirando. */
const loadArea = async (area: StatsArea, range: StatsRange): Promise<StatsPayload> => {
  switch (area) {
    case "ventas":
      return { area, data: await getSalesStats(range) };
    case "embudo":
      return { area, data: await getFunnelStats(range) };
    case "contactos":
      return { area, data: await getPeopleStats(range) };
    case "contenido":
      return { area, data: await getContentStats(range) };
  }
};

const EstadisticasPage = async ({ searchParams }: Props) => {
  const sp = await searchParams;
  const area = parseStatsArea(sp.area);

  // Vista previa (dev local sin base de datos): fixtures fijos, ninguna consulta real.
  if (isCrmUiPreview()) {
    const range = parseStatsRange(sp, OPERATIONAL_TZ);
    const payload: StatsPayload = { area, data: PREVIEW_STATS[area] } as StatsPayload;
    return <StatsPageClient payload={payload} range={serializeStatsRange(range)} />;
  }

  const staff = await getStaffSession();
  // Sin sesión: el layout del grupo `(panel)` ya redirige a `/acceso`.
  if (!staff) return null;
  // Estadísticas es solo para quien administra el equipo (OWNER) — el resto
  // del staff no la ve en el menú, y si llega a la URL a mano se le rebota
  // aquí en vez de dejarla cargar a medias.
  if (staff.role !== "OWNER") redirect("/admin");

  const timeZone = await getOperationalTimezone().catch(() => OPERATIONAL_TZ);
  const range = parseStatsRange(sp, timeZone);

  // La consulta va dentro del try y el JSX fuera: un try/catch no atrapa
  // errores de render (eso es cosa de un error boundary), sólo los de la carga.
  let payload: StatsPayload | null = null;
  try {
    payload = await loadArea(area, range);
  } catch {
    payload = null;
  }

  if (!payload) {
    // `data` no se usa mientras hay `error` (el cliente pinta el aviso en su
    // lugar), pero necesita una forma válida del área para que el tipado de
    // `StatsPayload` siga siendo correcto.
    const fallback: StatsPayload = { area, data: PREVIEW_STATS[area] } as StatsPayload;
    return (
      <StatsPageClient
        payload={fallback}
        range={serializeStatsRange(range)}
        error="No se pudieron cargar las estadísticas. Intenta de nuevo en unos minutos."
      />
    );
  }

  return <StatsPageClient payload={payload} range={serializeStatsRange(range)} />;
};

export default EstadisticasPage;
