import WorkshopsPageClient, {
  type WorkshopListItem,
} from "@/app/components/admin/crm/workshops/WorkshopsPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { formatMoneyMinor } from "@/lib/crm/money";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { listWorkshopCopySources, listWorkshopsForPanel, type WorkshopListRow } from "@/lib/crm/workshop-panel";

export const dynamic = "force-dynamic";

/** «$ 180.000 COP · US$45.00», o «Sin precio» si no tiene ninguno. */
const priceLine = (prices: WorkshopListRow["prices"]): string => {
  const parts: string[] = [];
  if (prices.cop != null) parts.push(`$ ${formatMoneyMinor(prices.cop, "COP")} COP`);
  if (prices.usd != null) parts.push(`US$${formatMoneyMinor(prices.usd, "USD")}`);
  return parts.length > 0 ? parts.join(" · ") : "Sin precio";
};

const PREVIEW_WORKSHOPS: WorkshopListItem[] = [
  {
    id: "pw1",
    slug: "saca-tu-mejor-version",
    title: "Saca tu mejor versión",
    status: "COMPLETED",
    ended: true,
    dateLabel: "16 de mayo de 2026, 7:30 a. m.",
    scheduleLabel: "7:30 a.m. – 4:30 p.m. · virtual",
    publicPath: "/taller-virtual/saca-tu-mejor-version",
    priceLine: "$ 180.000 COP · US$45.00",
    hasCopPrice: true,
    legacyProduct: false,
    hasMeetingUrl: true,
    paid: 12,
    stats: { email24h: 12, email1h: 11, wa24h: 10, wa1h: 9 },
  },
];

/**
 * Los talleres, uno por fila, como los eventos gratuitos: «Próximos» (el
 * publicado, los cerrados que aún no pasan y los borradores) y «Pasados»
 * (`?vista=pasados`).
 */
const WorkshopsAdminPage = async ({ searchParams }: { searchParams: Promise<{ vista?: string }> }) => {
  const sp = await searchParams;
  const preview = isCrmUiPreview();
  const tz = await getOperationalTimezone();
  const [rows, copySources] = preview
    ? [null, []]
    : await Promise.all([listWorkshopsForPanel(tz), listWorkshopCopySources(tz)]);

  const workshops: WorkshopListItem[] = rows
    ? rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        status: r.status,
        ended: r.ended,
        dateLabel: r.dateLabel,
        scheduleLabel: r.scheduleLabel,
        publicPath: r.publicPath,
        priceLine: priceLine(r.prices),
        hasCopPrice: r.prices.cop != null,
        legacyProduct: r.legacyProduct,
        hasMeetingUrl: r.hasMeetingUrl,
        paid: r.stats.paid,
        stats: { email24h: r.stats.email24h, email1h: r.stats.email1h, wa24h: r.stats.wa24h, wa1h: r.stats.wa1h },
      }))
    : PREVIEW_WORKSHOPS;

  // Sin próximos, se abre en los pasados: es lo que hay que ver.
  const hasUpcoming = workshops.some((w) => !w.ended);
  const initialView =
    sp.vista === "pasados" || (!sp.vista && !hasUpcoming && workshops.length > 0) ? "pasados" : "proximos";

  return (
    <WorkshopsPageClient
      workshops={workshops}
      initialView={initialView}
      operationalTimezone={tz}
      copySources={copySources}
      readOnly={preview}
    />
  );
};

export default WorkshopsAdminPage;
