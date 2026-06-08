import { NextResponse } from "next/server";
import { getStaffSession } from "./staff-session";
import type { StaffUser } from "@prisma/client";
import { canWriteCrm } from "@/lib/crm/staff";

export const resolveAdminStaff = async (): Promise<
  StaffUser | NextResponse
> => {
  const staff = await getStaffSession();
  if (!staff) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return staff;
};

export const requireWriteStaff = async (): Promise<
  StaffUser | NextResponse
> => {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canWriteCrm(staff.role)) {
    return NextResponse.json({ error: "read_only" }, { status: 403 });
  }
  return staff;
};
