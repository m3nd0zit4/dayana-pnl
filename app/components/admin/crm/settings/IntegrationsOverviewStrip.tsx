import { GROUP_ANCHOR } from "@/lib/integrations/catalog";
import { getIntegrationBrand, SimpleIconGlyph } from "@/lib/integrations/brand";
import type { IntegrationOverviewItem } from "@/lib/crm/integrations";

const DOT_CLASS: Record<IntegrationOverviewItem["status"], string> = {
  ok: "bg-emerald-500",
  attention: "bg-amber-500",
  off: "bg-muted-foreground/40",
};

/**
 * Franja de un vistazo con las {@link IntegrationOverviewItem} agregadas.
 * Cada pastilla enlaza a la sección de detalle correspondiente más abajo en
 * la misma página — no tiene acciones propias.
 */
const IntegrationsOverviewStrip = ({
  items,
}: {
  items: IntegrationOverviewItem[];
}) => (
  <div className="flex flex-wrap gap-2">
    {items.map((item) => (
      <a
        key={item.id}
        href={`#${GROUP_ANCHOR[item.group]}`}
        title={item.detail}
        className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-foreground transition-colors hover:bg-muted"
      >
        <SimpleIconGlyph
          visual={getIntegrationBrand(item)}
          className="size-3.5 shrink-0"
        />
        {item.label}
        <span
          className={`size-1.5 shrink-0 rounded-full ${DOT_CLASS[item.status]}`}
          aria-hidden
        />
      </a>
    ))}
  </div>
);

export default IntegrationsOverviewStrip;
