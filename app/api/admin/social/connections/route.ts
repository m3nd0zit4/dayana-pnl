import { NextResponse } from "next/server";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import { getSocialConnections } from "@/lib/crm/social-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async () => {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  return NextResponse.json({ connections: await getSocialConnections() });
};
