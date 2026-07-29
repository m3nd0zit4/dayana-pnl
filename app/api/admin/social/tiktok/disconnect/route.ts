import { NextResponse } from "next/server";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import { disconnectTikTokConnection } from "@/lib/crm/social-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = async () => {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  try {
    await disconnectTikTokConnection(staff.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "disconnect_failed" },
      { status: 500 }
    );
  }
};
