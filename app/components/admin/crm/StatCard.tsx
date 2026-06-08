import type { LucideIcon } from "lucide-react";

type Props = {
  label: string;
  value: string | number;
  icon: LucideIcon;
  accent?: string;
};

const StatCard = ({ label, value, icon: Icon, accent = "var(--crm-accent)" }: Props) => (
  <div className="crm-surface-card group min-w-[140px] flex-1 p-5 transition-shadow hover:shadow-md">
    <div
      className="flex size-9 items-center justify-center rounded-xl"
      style={{
        backgroundColor: `color-mix(in srgb, ${accent} 18%, transparent)`,
      }}
    >
      <Icon className="size-[18px]" style={{ color: accent }} strokeWidth={1.75} />
    </div>
    <p className="crm-font-display mt-4 text-[10px] text-[var(--crm-muted)]">
      {label}
    </p>
    <p className="mt-1 text-3xl font-semibold tracking-tight text-[var(--crm-foreground)] tabular-nums">
      {value}
    </p>
  </div>
);

export default StatCard;
