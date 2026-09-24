import { NextResponse } from "next/server";

import { apiError, withStaff } from "@/lib/api/handler";
import { getMessageInfo } from "@/lib/crm/whatsapp-message-actions";

export const dynamic = "force-dynamic";

type Params = { id: string };

/** «Info del mensaje»: el historial de acuses de WhatsApp de un mensaje. */
export const GET = withStaff<Params>("read", async ({ params }) => {
  const info = await getMessageInfo(params.id);
  if (!info) return apiError("not_found", 404);
  return NextResponse.json(info);
});
