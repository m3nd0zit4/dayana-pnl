import { NextResponse } from "next/server";
import { withStaff } from "@/lib/api/handler";
import {
  getIntegrationHealth,
  getNotificationsRuntimeStatus,
} from "@/lib/notifications/health";

export const dynamic = "force-dynamic";

export const GET = withStaff("owner", async () => {
  // Puro entorno: no se toca la red ni la base al responder.
  return NextResponse.json({
    integrations: getIntegrationHealth(),
    runtime: getNotificationsRuntimeStatus(),
  });
});
