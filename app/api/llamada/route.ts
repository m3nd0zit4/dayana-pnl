import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { clientIp, rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { CHANNEL_LABEL, channelOf, parseStartBody } from "@/lib/crm/call-funnel/rules";
import { startLead } from "@/lib/crm/call-funnel/server";
import { fireNotification } from "@/lib/notifications/platform/emit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Paso 1 del embudo de la llamada gratis (`/llamada`): nombre y WhatsApp.
 *
 * Se guarda al instante —contacto, su chat y la fila del embudo— para que
 * quien no termine igual quede en el CRM. Trampa para bots y límite por IP
 * como `/api/leads`. La respuesta nunca dice si ese número ya existía, ya
 * tenía una llamada o está bloqueado: siempre un enlace nuevo.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`llamada-datos:${ip}`, 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const parsed = parseStartBody(body);
  // Un enlace que no existe: los pasos siguientes le dirán «escríbenos por WhatsApp».
  const decoy = () => NextResponse.json({ ok: true, token: randomBytes(24).toString("base64url") });
  if (!parsed.ok) {
    if (parsed.error === "honeypot") {
      console.warn("[llamada-web] trampa de bots rellenada; se ignora");
      return decoy();
    }
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const input = parsed.value;
  try {
    const result = await startLead(input);
    if (result.status === "blocked") return decoy();
    // Al equipo, solo la primera vez que esa persona entra (repetir el formulario no llena la campana).
    if (result.firstTime) {
      fireNotification({
        eventType: "WEB_LEAD_SUBMITTED",
        title: `Pidió su llamada gratis: ${[input.firstName, input.lastName].filter(Boolean).join(" ")}`,
        body: [result.phoneE164, `llegó por ${CHANNEL_LABEL[channelOf(input.attribution)]}`, "aún sin hora"].join(" · "),
        href: "/admin/embudo",
        entityType: "Contact",
        entityId: result.contactId,
        metadata: { source: "llamada_web", leadId: result.leadId },
        staff: "ALL",
      });
    }
    return NextResponse.json({ ok: true, token: result.token });
  } catch (e) {
    if (e instanceof Error && e.message === "INVALID_PHONE") {
      return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
    }
    console.error("[llamada-web] paso 1", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
