import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { whatsAppStatusFor } from "@/lib/crm/whatsapp-outbound";

export const dynamic = "force-dynamic";

/** Estado de WhatsApp (enviado, entregado, leído, respondió) de varios contactos. */
export const POST = withStaff("read", async ({ req }) => {
  const parsed = z.object({ contactIds: z.array(z.string()).max(1000) }).safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  return NextResponse.json({ statuses: await whatsAppStatusFor(parsed.data.contactIds) });
});
