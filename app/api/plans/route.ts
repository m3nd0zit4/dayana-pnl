import { NextResponse } from "next/server";
import { getPublicPlans } from "@/lib/plans-from-db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { therapyPlans, coursePlan, allPlans, usdToCopRate } =
      await getPublicPlans();
    return NextResponse.json(
      { therapyPlans, coursePlan, allPlans, usdToCopRate },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
