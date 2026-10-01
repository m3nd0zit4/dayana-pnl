import { cn } from "@/lib/utils";

/** Los contadores de envío de un evento (`FreeEventStats` sin el total). */
export type ReminderStats = {
  linkSent: number;
  reminder24h: number;
  reminder1h: number;
  wa24h: number;
  wa1h: number;
  waConfirmation: number;
};

const n = (v: number) => (v > 0 ? v.toLocaleString("es-CO") : "—");

/**
 * Cómo van los envíos de un evento, en dos líneas cortas que caben en el
 * teléfono: correo (enlace, 24 h, 1 h) y WhatsApp (confirmación, 24 h, 1 h).
 */
const ReminderProgress = ({
  stats,
  total,
  className,
}: {
  stats: ReminderStats;
  total: number;
  className?: string;
}) => (
  <span className={cn("block space-y-0.5 text-[11px] leading-snug text-muted-foreground tabular-nums", className)}>
    <span className="block">
      <span className="font-medium text-foreground/80">Correo</span> · enlace {n(stats.linkSent)}/
      {total.toLocaleString("es-CO")} · 24 h {n(stats.reminder24h)} · 1 h {n(stats.reminder1h)}
    </span>
    <span className="block">
      <span className="font-medium text-foreground/80">WhatsApp</span> · confirmación {n(stats.waConfirmation)} ·
      24 h {n(stats.wa24h)} · 1 h {n(stats.wa1h)}
    </span>
  </span>
);

export default ReminderProgress;
