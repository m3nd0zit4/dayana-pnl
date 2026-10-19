import { NextResponse } from "next/server";

import { withStaff } from "@/lib/api/handler";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { isOverBudget } from "@/lib/crm/whatsapp-agent/spend";
import { spendSummary } from "@/lib/crm/whatsapp-agent/spend-store";

export const dynamic = "force-dynamic";

/** Lo que costaron las respuestas de la IA (hoy, 7 días, el mes) y si ya pasó el tope del día. */
export const GET = withStaff("read", async () => {
  const [summary, config] = await Promise.all([spendSummary(), getWhatsAppAiConfig()]);
  return NextResponse.json({ ...summary, overBudget: isOverBudget(summary.today.usd, config.spend.dailyBudgetUsd) });
});
