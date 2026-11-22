import { NextResponse } from "next/server";

import { withStaff } from "@/lib/api/handler";
import { guardReport } from "@/lib/crm/whatsapp-agent/guard-report";

export const dynamic = "force-dynamic";

/** Lo que frenaron o corrigieron las protecciones de la IA en los últimos días (`?days=7`, máx. 30). */
export const GET = withStaff("owner", async ({ req }) => {
  const days = Number(new URL(req.url).searchParams.get("days") ?? 7);
  return NextResponse.json(await guardReport(Number.isFinite(days) ? days : 7));
});
