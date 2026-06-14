import type { LucideIcon } from "lucide-react";

type Props = {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  accent?: string;
};

const StatCard = ({ label, value }: Props) => (
  <div className="crm-surface-card crm-stat-card">
    <p className="crm-stat-value">{value}</p>
    <p className="crm-stat-label">{label}</p>
  </div>
);

export default StatCard;
