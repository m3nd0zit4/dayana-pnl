import { NextResponse } from "next/server";

import { getMemberSession } from "@/lib/auth/member-session";
import { recordContactTouch } from "@/lib/crm/whatsapp-touches";

export const dynamic = "force-dynamic";

/** `floating` (boton flotante) o `plan:<id>` (botones de un paquete). */
const KNOWN_SOURCE = /^(floating|plan:[a-z0-9-]{1,40})$/;

/**
 * Clic en un botón de WhatsApp de la web. Sólo se registra si quien pulsa es
 * una miembro con sesión: de una visita anónima no sabemos a qué ficha
 * pertenece, y adivinarlo sería peor que no saberlo.
 *
 * Siempre 200: es telemetría.
 */
export async function POST(req: Request) {
  try {
    const member = await getMemberSession();
    if (member) {
      const body = (await req.json().catch(() => null)) as { source?: unknown } | null;
      // Solo origenes conocidos: el texto libre formaba parte de la clave de
      // deduplicado y dejaba a una sesion llenar su ficha de filas.
      const where =
        typeof body?.source === "string" && KNOWN_SOURCE.test(body.source)
          ? body.source
          : null;
      await recordContactTouch({
        contactId: member.contact.id,
        kind: "LEAD_WHATSAPP",
        source: where ? `web:${where}` : "web",
      });
    }
  } catch (e) {
    console.error("[whatsapp-click] no se pudo registrar", e);
  }
  return NextResponse.json({ ok: true });
}
