import { CalendarDays, GraduationCap, MessageCircle, Sparkles, TrendingUp, Users, type LucideIcon } from "lucide-react";
import type { AgentId } from "@/agent/lib/catalog";

/** One icon per agent, the same in the picker, the header, the empty state and the history list. */
export const AGENT_ICONS: Record<AgentId, LucideIcon> = {
  auto: Sparkles,
  ventas: TrendingUp,
  whatsapp: MessageCircle,
  agenda: CalendarDays,
  talleres: GraduationCap,
  contactos: Users,
};
