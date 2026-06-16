import { NextResponse } from "next/server";
import { getPublicPlans } from "@/lib/plans-from-db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { therapyPlans, coursePlan, allPlans } = await getPublicPlans();
    return NextResponse.json(
      { therapyPlans, coursePlan, allPlans },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
