import { NextResponse } from "next/server";
import { getStaffSession } from "./staff-session";
import type { StaffUser } from "@prisma/client";
import {
  canBroadcastNotifications,
  canRecordManualPayments,
  canSendTestEmail,
  canWriteCrm,
} from "@/lib/crm/staff-permissions";

export const resolveAdminStaff = async (): Promise<
  StaffUser | NextResponse
> => {
  const staff = await getStaffSession();
  if (!staff) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
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

export const requireOwnerStaff = async (): Promise<StaffUser | NextResponse> => {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;
  if (staff.role !== "OWNER") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return staff;
};

export const requireBroadcastStaff = async (): Promise<
  StaffUser | NextResponse
> => {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canBroadcastNotifications(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return staff;
};

export const requireManualPaymentStaff = async (): Promise<
  StaffUser | NextResponse
> => {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canRecordManualPayments(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return staff;
};

export const requireTestEmailStaff = async (): Promise<
  StaffUser | NextResponse
> => {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;
  if (!canSendTestEmail(staff.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return staff;
};
