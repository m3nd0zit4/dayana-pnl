import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { disconnectMetaConnection } from "@/lib/crm/social-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withStaff("owner", async ({ staff }) => {
  try {
    return NextResponse.json(await disconnectMetaConnection(staff.id));
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "disconnect_failed", 500);
  }
});
