import { NextResponse } from "next/server";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import {
  getIntegrationHealth,
  getNotificationsRuntimeStatus,
} from "@/lib/notifications/health";

export const dynamic = "force-dynamic";

export const GET = async () => {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  // Puro entorno: no se toca la red ni la base al responder.
  return NextResponse.json({
    integrations: getIntegrationHealth(),
    runtime: getNotificationsRuntimeStatus(),
  });
};
