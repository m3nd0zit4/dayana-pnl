import { NextResponse } from "next/server";

import { decodeWhatsAppRedirect } from "@/lib/crm/whatsapp-redirect";
import { recordContactTouch } from "@/lib/crm/whatsapp-touches";

export const dynamic = "force-dynamic";

/**
 * Registra el clic de un enlace `/w/…` (correo). Lo llama la página intermedia
 * desde el navegador justo antes de saltar a WhatsApp: los escáneres de correo
 * que «abren» enlaces solos no ejecutan JavaScript, así que no llegan aquí.
 *
 * Siempre 200: es telemetría y no puede frenar a quien va a escribir.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const payload = decodeWhatsAppRedirect(code);
  if (payload) {
    await recordContactTouch({
      contactId: payload.contactId,
      kind: payload.kind === "staff" ? "STAFF_WHATSAPP" : "LEAD_WHATSAPP",
      source: payload.source,
    });
  }
  return NextResponse.json({ ok: true });
}
