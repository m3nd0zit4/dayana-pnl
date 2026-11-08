import { NextResponse, type NextRequest } from "next/server";
import { fireAuditLog } from "@/lib/crm/audit";
import { recordOwnerCallAnswer } from "@/lib/voice/calls/owner-call";
import { callClosingTwiml } from "@/lib/voice/calls/twiml";
import { verifyTwilioWebhook } from "@/lib/webhooks/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Llamadas del asistente a Dayana (Twilio). Dos pasos, misma ruta:
 * - `s=gather`: Twilio manda lo que entendió de su respuesta (`SpeechResult`);
 *   se guarda, llega al panel como mensaje del asistente y se cuelga.
 * - `s=status`: el estado de la llamada (contestó, terminó). Solo se registra.
 *
 * Firmado como los otros webhooks de Twilio (`verifyTwilioWebhook`: la URL
 * configurada + los campos del formulario). La clave `c` además tiene que ser
 * una llamada real de las últimas 2 h, y su `CallSid` el de esa llamada.
 */
const xml = (body: string) => new NextResponse(body, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!verifyTwilioWebhook(req, rawBody)) {
    fireAuditLog({ action: "WEBHOOK_REJECTED", entityType: "AGENT_CALL", entityId: "twilio", changes: { reason: "invalid_signature" } });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  const url = new URL(req.url);
  const callKey = url.searchParams.get("c") ?? "";
  const step = url.searchParams.get("s");
  const params = new URLSearchParams(rawBody);
  const callSid = params.get("CallSid");

  if (step === "status") {
    fireAuditLog({
      action: "UPDATE",
      entityType: "AGENT_CALL_STATUS",
      entityId: callKey.slice(0, 40) || "?",
      changes: { status: params.get("CallStatus"), answeredBy: params.get("AnsweredBy"), duration: params.get("CallDuration") },
    });
    return NextResponse.json({ ok: true });
  }

  const heard = params.get("SpeechResult");
  const result = await recordOwnerCallAnswer({ callKey, heard, providerCallId: callSid });
  if (!result.ok && result.reason === "unknown_call") {
    return xml('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  }
  return xml(callClosingTwiml(heard?.trim() ? heard : null));
}
