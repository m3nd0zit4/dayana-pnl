import { NextResponse } from "next/server";

import { withStaff } from "@/lib/api/handler";
import { getOverview } from "@/lib/crm/whatsapp-agent/workspace";

export const dynamic = "force-dynamic";

export const GET = withStaff("read", async () => NextResponse.json(await getOverview()));
