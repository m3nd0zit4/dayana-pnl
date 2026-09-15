import { NextResponse } from "next/server";
import { withStaff } from "@/lib/api/handler";
import { getSocialConnections } from "@/lib/crm/social-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withStaff("owner", async () => {
  return NextResponse.json({ connections: await getSocialConnections() });
});
