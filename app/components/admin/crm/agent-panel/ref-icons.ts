import { CalendarDays, CreditCard, GraduationCap, HeartPulse, Link2, Package, Users, type LucideIcon } from "lucide-react";

/** Same per-entity icons already established in `app/config/crm-menu-items.ts`, reused here for ref chips. */
export const REF_TYPE_ICONS: Record<string, LucideIcon> = {
  contact: Users,
  enrollment: GraduationCap,
  payment: CreditCard,
  therapy: HeartPulse,
  workshop: CalendarDays,
  product: Package,
};

export const refTypeIcon = (type: string): LucideIcon => REF_TYPE_ICONS[type] ?? Link2;
