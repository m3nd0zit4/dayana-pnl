import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/app/components/ui/card";

type Props = {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  accent?: string;
};

const StatCard = ({ label, value }: Props) => (
  <Card className="py-4">
    <CardContent className="px-4">
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </CardContent>
  </Card>
);

export default StatCard;
