import { NextResponse } from "next/server";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import { disconnectMetaConnection } from "@/lib/crm/social-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = async () => {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  try {
    return NextResponse.json(await disconnectMetaConnection(staff.id));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "disconnect_failed" },
      { status: 500 }
    );
  }
};
