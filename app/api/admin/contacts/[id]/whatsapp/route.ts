import { NextResponse } from "next/server";

import { readJson, withStaff } from "@/lib/api/handler";
import { recordContactTouch } from "@/lib/crm/whatsapp-touches";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Alguien del equipo abrió WhatsApp con esta persona desde el CRM. Cuenta
 * para cualquier rol con sesión: abrir un chat no es escribir en el CRM.
 */
export const POST = withStaff<Params>("read", async ({ req, staff, params }) => {
  const body = (await readJson(req)) as { source?: unknown; diagnosticId?: unknown } | null;
  await recordContactTouch({
    contactId: params.id,
    diagnosticId: typeof body?.diagnosticId === "string" ? body.diagnosticId : null,
    staffUserId: staff.id,
    kind: "STAFF_WHATSAPP",
    source: typeof body?.source === "string" ? body.source : "crm",
  });
  return NextResponse.json({ ok: true });
});
