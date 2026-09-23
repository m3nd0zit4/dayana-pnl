import { NextResponse } from "next/server";

import { withStaff } from "@/lib/api/handler";
import { listDayanaStickers } from "@/lib/crm/whatsapp-agent/workspace";

export const dynamic = "force-dynamic";

/** Los stickers de Dayana, para el selector del chat. */
export const GET = withStaff("read", async () =>
  NextResponse.json({ items: await listDayanaStickers() })
);
