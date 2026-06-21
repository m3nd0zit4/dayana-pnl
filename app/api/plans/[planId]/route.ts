import { NextResponse } from "next/server";
import { resolveUsdToCopRate } from "@/lib/crm/site-settings";
import { getPlanFromDb, isActivePlanId } from "@/lib/plans-from-db";
import { isPlanId } from "@/lib/plans";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ planId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const { planId } = await context.params;

  if (!isPlanId(planId) || !(await isActivePlanId(planId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [plan, usdToCopRate] = await Promise.all([
    getPlanFromDb(planId),
    resolveUsdToCopRate(),
  ]);

  if (!plan) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(
    { plan, usdToCopRate },
    { headers: { "Cache-Control": "no-store" } }
  );
}
