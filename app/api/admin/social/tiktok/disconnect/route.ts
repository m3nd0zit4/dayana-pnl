import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { disconnectTikTokConnection } from "@/lib/crm/social-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withStaff("owner", async ({ staff }) => {
  try {
    await disconnectTikTokConnection(staff.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "disconnect_failed", 500);
  }
});
